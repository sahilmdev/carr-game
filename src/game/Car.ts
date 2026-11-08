import * as THREE from 'three'
import type { InputState } from '../engine/Input'
import { AssetLoader } from './AssetLoader'

export interface CarConfig {
  acceleration: number
  braking: number
  maxSpeed: number
  maxReverseSpeed: number
  turnSpeed: number
  friction: number
  driftFactor: number
  bodyRollAmount: number
  downforce: number
}

export const CAR_CONFIG: CarConfig = {
  acceleration: 30,
  braking: 34,
  maxSpeed: 64,
  maxReverseSpeed: 14,
  turnSpeed: 2.55,
  friction: 0.022,
  driftFactor: 0.24,
  bodyRollAmount: 0.05,
  downforce: 0.4,
}

/** Body color of the player car. Metallic paint under a glossy clear coat. */
const CAR_PAINT_COLOR = 0xe0142a

/** Two-layer automotive paint: metallic base + glossy clear coat that mirrors the sky. */
function createCarPaint(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: CAR_PAINT_COLOR,
    metalness: 0.45,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.5,
  })
}

/** Dark tinted glass: almost no diffuse, strong sky reflections. */
function createCarGlass(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0x0b0e12,
    metalness: 0,
    roughness: 0.03,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
  })
}

/**
 * Arcade car physics + a procedural low-poly 80s wedge supercar:
 * black body, fender flares, orange taillight bar, EDITION plate,
 * rear wing, diffuser fins, twin exhausts.
 */
export class Car {
  public readonly mesh: THREE.Group
  public readonly position: THREE.Vector3
  public heading = 0
  /** Smoothed steer, -1..1 (right..left). Read by the chase camera for lean. */
  public steer = 0

  /** True while braking with speed on (brake lights, tyre smoke). */
  public braking = false
  /** 0/1 throttle input this frame (engine sound). */
  public throttle = 0

  private speed = 0
  private readonly velocity: THREE.Vector3
  // Suspension springs (body motion relative to the wheels)
  private pitch = 0
  private pitchV = 0
  private roll = 0
  private rollV = 0
  private heave = 0
  private heaveV = 0
  private slip = 0
  /** Tyre load 0–1: builds while a turn is held at speed (keyboard steering is on/off). */
  private load = 0
  private readonly tailMats: THREE.MeshStandardMaterial[] = []
  private readonly paintMats: THREE.MeshStandardMaterial[] = []
  private paint = CAR_PAINT_COLOR
  private readonly headMats: THREE.MeshStandardMaterial[] = []
  private headlightLevel = 0
  private readonly headlight: THREE.SpotLight | null = null
  /** Nitro tank 0–1 and whether it's firing this frame. */
  public nitro = 1
  public boosting = false
  private readonly flame: THREE.Group
  private readonly flameMat: THREE.MeshBasicMaterial
  private readonly _right = new THREE.Vector3()
  private readonly config: CarConfig
  private readonly wheels: THREE.Object3D[] = []
  private readonly frontWheels: THREE.Object3D[] = []
  private wheelRadius = 0.38
  private bodyGroup: THREE.Group

  private readonly _forwardDir = new THREE.Vector3()
  private readonly _idealVelocity = new THREE.Vector3()
  private readonly _moveDir = new THREE.Vector3()

  /** @param lite for rivals: no headlight beam, which would cost every material a light */
  constructor(config: CarConfig = CAR_CONFIG, private readonly lite = false) {
    this.config = { ...config }
    this.position = new THREE.Vector3()
    this.velocity = new THREE.Vector3()
    this.mesh = new THREE.Group()
    this.mesh.rotation.order = 'YXZ' // yaw, then slope pitch
    this.bodyGroup = new THREE.Group()
    this.mesh.add(this.bodyGroup)
    this.buildMesh()

    // Exhaust flames for the nitro boost (bright HDR color so bloom glows)
    this.flameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.4, 0.65, 1.0).multiplyScalar(6),
      transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    const cone = new THREE.ConeGeometry(0.11, 0.9, 10, 1, true)
    cone.translate(0, 0.45, 0)
    cone.rotateX(Math.PI / 2) // tip points backwards (+Z)
    const core = new THREE.ConeGeometry(0.05, 0.55, 8, 1, true)
    core.translate(0, 0.27, 0)
    core.rotateX(Math.PI / 2)
    const coreMat = this.flameMat.clone()
    coreMat.color = new THREE.Color(1, 0.95, 0.85).multiplyScalar(10)
    this.flame = new THREE.Group()
    for (const x of [-0.3, 0.3]) {
      const f = new THREE.Mesh(cone, this.flameMat)
      const c = new THREE.Mesh(core, coreMat)
      f.position.x = c.position.x = x
      this.flame.add(f, c)
    }
    this.flame.position.set(0, 0.24, 2.36)
    this.flame.visible = false
    this.mesh.add(this.flame)

    // Headlights: one spot light (always present so toggling it never
    // recompiles shaders); intensity is driven by time of day.
    if (!lite) {
      this.headlight = new THREE.SpotLight(0xfff1dc, 0, 70, 0.55, 0.65, 1.4)
      this.headlight.position.set(0, 0.75, -2.2)
      this.headlight.target.position.set(0, -0.6, -24)
      this.mesh.add(this.headlight, this.headlight.target)
    }
    // The sharp camera-following shadow map draws the car's real shadow;
    // the blob decal in Game only adds a soft contact shadow under it.
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) child.castShadow = true
    })
  }

  // ── Procedural low-poly wedge supercar ───────────────────────────────
  private buildMesh(): void {
    const g = this.bodyGroup

    const bodyMat = createCarPaint()
    const darkTrim = new THREE.MeshStandardMaterial({
      color: 0x060609,
      roughness: 0.6,
      metalness: 0.4,
    })
    const glassMat = createCarGlass()

    // Main wedge: side profile extruded across the width. Car faces -Z.
    const profile = new THREE.Shape()
    profile.moveTo(-2.3, 0.34)   // nose tip (low)
    profile.lineTo(-2.34, 0.5)   // nose face
    profile.lineTo(-1.6, 0.56)   // front clip
    profile.lineTo(-0.7, 0.66)   // hood
    profile.lineTo(-0.05, 1.06)  // windshield
    profile.lineTo(0.95, 1.08)   // roof
    profile.lineTo(1.7, 0.88)    // rear deck (fastback)
    profile.lineTo(2.3, 0.84)    // tail top
    profile.lineTo(2.3, 0.34)    // tail face
    profile.lineTo(1.95, 0.2)    // under rear
    profile.lineTo(-1.95, 0.2)   // floor
    profile.lineTo(-2.3, 0.34)

    const bodyGeo = new THREE.ExtrudeGeometry(profile, {
      depth: 1.9,
      bevelEnabled: true,
      bevelThickness: 0.1,
      bevelSize: 0.1,
      bevelSegments: 2,
    })
    bodyGeo.rotateY(-Math.PI / 2)
    bodyGeo.computeBoundingBox()
    const bb = bodyGeo.boundingBox!
    bodyGeo.translate(-(bb.min.x + bb.max.x) / 2, 0, 0)
    const body = new THREE.Mesh(bodyGeo, bodyMat)
    body.castShadow = true
    g.add(body)

    // Fender flares over each wheel
    const flareGeo = new THREE.BoxGeometry(0.28, 0.34, 1.15)
    for (const [sx, sz] of [[-1.02, -1.45], [1.02, -1.45], [-1.02, 1.45], [1.02, 1.45]] as const) {
      const flare = new THREE.Mesh(flareGeo, bodyMat)
      flare.position.set(sx, 0.62, sz)
      flare.castShadow = true
      g.add(flare)
    }

    // Side skirts
    for (const sx of [-1.08, 1.08]) {
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 2.4), darkTrim)
      skirt.position.set(sx, 0.28, 0)
      g.add(skirt)
    }

    // Front splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.09, 0.5), darkTrim)
    splitter.position.set(0, 0.22, -2.3)
    g.add(splitter)

    // Greenhouse: windshield + side glass + rear glass
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 1.6), glassMat)
    canopy.position.set(0, 0.99, 0.38)
    canopy.castShadow = true
    g.add(canopy)

    // Hood vents (NACA-ish dark inserts)
    for (const sx of [-0.45, 0.45]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.7), darkTrim)
      vent.position.set(sx, 0.72, -1.0)
      g.add(vent)
    }

    // Roof scoop
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.55), darkTrim)
    scoop.position.set(0, 1.16, 0.95)
    g.add(scoop)

    // Rear wing on struts
    const wing = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.08, 0.55), darkTrim)
    wing.position.set(0, 1.14, 2.0)
    wing.rotation.x = -0.09
    wing.castShadow = true
    g.add(wing)
    for (const sx of [-0.85, 0.85]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.32), darkTrim)
      strut.position.set(sx, 0.98, 2.05)
      g.add(strut)
    }

    // Rear panel: black bar housing + wide orange taillights
    const tailHousing = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.34, 0.08), darkTrim)
    tailHousing.position.set(0, 0.62, 2.36)
    g.add(tailHousing)

    const tailMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff2200,
      emissiveIntensity: 1.4,
    })
    this.tailMats.push(tailMat)
    for (const sx of [-0.62, 0.62]) {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.22, 0.06), tailMat)
      tail.position.set(sx, 0.62, 2.41)
      g.add(tail)
    }

    // License plate: "ED1TION"
    const plateCanvas = document.createElement('canvas')
    plateCanvas.width = 128
    plateCanvas.height = 48
    const ctx = plateCanvas.getContext('2d')!
    ctx.fillStyle = '#e8ecf5'
    ctx.fillRect(0, 0, 128, 48)
    ctx.strokeStyle = '#8899cc'
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, 124, 44)
    ctx.fillStyle = '#2233aa'
    ctx.font = '700 30px Rajdhani, Arial, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('ED1TION', 64, 26)
    const plateTex = new THREE.CanvasTexture(plateCanvas)
    plateTex.colorSpace = THREE.SRGBColorSpace
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.6, 0.22),
      new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.7 })
    )
    plate.position.set(0, 0.36, 2.42)
    plate.rotation.y = Math.PI
    g.add(plate)

    // Diffuser fins under the tail
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.42), darkTrim)
      fin.position.set(i * 0.34, 0.14, 2.18)
      fin.rotation.x = 0.35
      g.add(fin)
    }

    // Twin exhausts
    const exhaustMat = new THREE.MeshStandardMaterial({
      color: 0x555566,
      roughness: 0.35,
      metalness: 1,
    })
    for (const sx of [-0.3, 0.3]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8), exhaustMat)
      pipe.rotation.x = Math.PI / 2
      pipe.position.set(sx, 0.24, 2.3)
      g.add(pipe)
    }

    // Headlights: slim strips on the nose
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xaabbff,
      emissiveIntensity: 1.4,
    })
    for (const sx of [-0.68, 0.68]) {
      this.headMats.push(headMat)
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.09, 0.06), headMat)
      head.position.set(sx, 0.47, -2.38)
      g.add(head)
    }

    // Wheels: tire + rim disc + hub
    const tireGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.34, 16)
    tireGeo.rotateZ(Math.PI / 2)
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.92 })
    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.36, 10)
    rimGeo.rotateZ(Math.PI / 2)
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x99a0b8,
      roughness: 0.25,
      metalness: 0.95,
    })
    const hubGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.38, 8)
    hubGeo.rotateZ(Math.PI / 2)
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x22242e, roughness: 0.4 })

    const wheelPositions: [number, number, number][] = [
      [-1.06, 0.38, -1.45],
      [1.06, 0.38, -1.45],
      [-1.06, 0.38, 1.45],
      [1.06, 0.38, 1.45],
    ]
    wheelPositions.forEach(([x, y, z], i) => {
      const wheelGroup = new THREE.Group()
      const tire = new THREE.Mesh(tireGeo, tireMat)
      const rim = new THREE.Mesh(rimGeo, rimMat)
      const hub = new THREE.Mesh(hubGeo, hubMat)
      tire.castShadow = true
      wheelGroup.add(tire, rim, hub)
      wheelGroup.position.set(x, y, z)
      this.mesh.add(wheelGroup)
      this.wheels.push(wheelGroup)
      if (i < 2) this.frontWheels.push(wheelGroup) // first two are front (-Z)
    })

  }

  // ── Physics update ───────────────────────────────────────────────────
  /** Road surface: extra sideways slip 0–1 (ice, mud) and drag in m/s². */
  surfaceSlip = 0
  surfaceDrag = 0
  /** Kart races: brake past zero to reverse. */
  canReverse = false
  /** Kart races: the tank only fills from good driving. */
  earnNitro = false
  /** Top speed multiplier for the area (tailwind on the salt). */
  topBonus = 1
  /** Seconds of extra launch acceleration left. */
  launch = 0
  /** True during a powerslide (brake + steer at speed). */
  drifting = false
  /** Seconds held in the current powerslide. */
  driftCharge = 0
  /** Seconds of short boost left (a released drift, a boost strip). */
  surge = 0
  /** Set for one update when a drift pays out: 1, 2 or 3 by how long it was held. */
  driftPaid = 0
  /** Steering after the tyres have taken up the input (-1..1). */
  private steerIn = 0

  /** A short burst of speed. */
  kick(seconds: number): void {
    this.surge = Math.max(this.surge, seconds)
    if (this.speed < this.config.maxSpeed) this.speed = Math.min(this.config.maxSpeed * 1.05, this.speed + 7)
  }

  update(dt: number, input: InputState): void {
    const cfg = this.config
    const prevSpeed = this.speed
    const prevHeading = this.heading

    // 0. Nitro: a 4 s tank that refills slowly. While firing it adds thrust
    // and lifts the top speed by 25%.
    this.boosting = !!input.nitro && this.nitro > 0.01 && !input.brake && this.speed > 3
    if (this.boosting) this.nitro = Math.max(0, this.nitro - dt / 4)
    else if (!this.earnNitro) this.nitro = Math.min(1, this.nitro + dt / 16)
    this.surge = Math.max(0, this.surge - dt)
    const topSpeed = cfg.maxSpeed * (this.boosting ? 1.25 : this.surge > 0 ? 1.16 : 1) * this.topBonus
    this.launch = Math.max(0, this.launch - dt)
    const steerRaw = (input.left ? 1 : 0) - (input.right ? 1 : 0)
    // brake + steer at speed: a powerslide that scrubs little speed and earns nitro
    this.drifting = input.brake && steerRaw !== 0 && this.speed > 26
    if (this.drifting) this.nitro = Math.min(1, this.nitro + dt * (this.earnNitro ? 0.2 : 0.1))
    // kart rule: hold a slide, then let go for a kick. Longer slides pay more.
    this.driftPaid = 0
    if (this.drifting) this.driftCharge += dt
    else {
      if (this.earnNitro && this.driftCharge > 0.7) {
        this.driftPaid = this.driftCharge > 2.2 ? 3 : this.driftCharge > 1.3 ? 2 : 1
        this.kick(0.45 + this.driftPaid * 0.35)
      }
      this.driftCharge = 0
    }

    // 1. Longitudinal — forward only, no reverse. Brake decelerates to 0.
    if (input.accelerate || this.boosting) {
      // Throttle only pushes up to the current top speed (never past it)
      if (this.speed < topSpeed) {
        this.speed = Math.min(topSpeed, this.speed + (cfg.acceleration + (this.boosting ? 22 : 0) + (this.surge > 0 ? 26 : 0) + (this.launch > 0 ? 16 : 0)) * dt)
      }
    } else if (input.brake) {
      this.speed -= (this.drifting ? 9 : cfg.braking) * dt
      if (this.canReverse && this.speed < 0) this.speed = Math.max(-cfg.maxReverseSpeed, this.speed + (cfg.braking - 16) * dt)
    } else {
      this.speed *= Math.pow(1 - cfg.friction, dt * 60)
    }
    // Over the normal top speed after a boost: ease back down, don't snap
    if (this.speed > topSpeed) this.speed = Math.max(topSpeed, this.speed - 9 * dt)
    if (this.surfaceDrag > 0 && this.speed > topSpeed * 0.7) this.speed -= this.surfaceDrag * dt * Math.min(1, this.speed / 20)
    if (!this.canReverse) this.speed = Math.max(0, this.speed)

    // Flame flicker
    this.flame.visible = this.boosting || this.surge > 0
    if (this.flame.visible) {
      for (const f of this.flame.children) f.scale.set(1, 1, 0.75 + Math.random() * 0.6)
      this.flameMat.opacity = 0.7 + Math.random() * 0.3
    }
    if (Math.abs(this.speed) < 0.05 && !input.accelerate && !input.brake) this.speed = 0

    // 2. Steering — turn rate scales with speed
    const absSpeed = Math.abs(this.speed)
    const speedRatio = absSpeed / cfg.maxSpeed
    const effectiveTurnSpeed = cfg.turnSpeed * Math.min(speedRatio * 2, 1)
    // keys are on/off: ease in over a few frames so the nose doesn't snap
    this.steerIn += (steerRaw - this.steerIn) * (1 - Math.exp(-dt * 14))
    this.heading += effectiveTurnSpeed * (this.drifting ? 1.3 : 1) * this.steerIn * dt * Math.sign(this.speed)

    // 3. Drift — velocity lags behind heading
    this._forwardDir.set(-Math.sin(this.heading), 0, -Math.cos(this.heading))
    this._idealVelocity.copy(this._forwardDir).multiplyScalar(this.speed)
    const lateralRetention = cfg.driftFactor * (1 - speedRatio * cfg.downforce)
    const clampedRetention = THREE.MathUtils.clamp(THREE.MathUtils.lerp(lateralRetention, 0.955, Math.max(this.surfaceSlip, this.drifting ? 0.72 : 0)), 0, 0.98)
    this.velocity.lerp(this._idealVelocity, 1 - clampedRetention)

    // 4. Apply velocity (horizontal; elevation is set by the track follow)
    if (this.velocity.lengthSq() > 0.0001) {
      this._moveDir.copy(this.velocity).normalize()
      this.position.addScaledVector(this._moveDir, absSpeed * dt)
    }

    // 5. Visuals
    this.mesh.position.copy(this.position)
    this.mesh.rotation.y = this.heading

    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0)
    this.steer = THREE.MathUtils.lerp(this.steer, steerInput, 0.15)

    // Grip state: sideways slip = lateral share of the velocity
    this._right.set(-this._forwardDir.z, 0, this._forwardDir.x)
    const vLen = this.velocity.length()
    this.slip = vLen > 1 ? Math.abs(this.velocity.dot(this._right)) / vLen : 0
    // Taps barely register; holding a corner at speed loads the tyres up over ~0.4 s
    const loadTarget = Math.abs(steerInput) * speedRatio
    this.load += (loadTarget - this.load) * (1 - Math.exp(-dt / 0.4))
    this.braking = input.brake && absSpeed > 0.5
    this.throttle = input.accelerate ? 1 : 0

    // Suspension: springs pull the body toward the pose that the
    // accelerations ask for — squat on throttle, dive on brakes, roll
    // outward in corners — and slightly overshoot, like real dampers.
    const safeDt = Math.max(dt, 1e-4)
    const longAccel = (this.speed - prevSpeed) / safeDt
    const yawRate = (this.heading - prevHeading) / safeDt
    const targetPitch = THREE.MathUtils.clamp(longAccel * 0.0009, -0.045, 0.03)
    const targetRoll = THREE.MathUtils.clamp(-absSpeed * yawRate * cfg.bodyRollAmount * 0.008, -0.065, 0.065)
    this.stepSprings(dt, targetPitch, targetRoll, speedRatio)
    this.bodyGroup.rotation.x = this.pitch
    this.bodyGroup.rotation.z = this.roll
    this.bodyGroup.position.y = this.heave

    // Brake lights flare when braking
    const tail = this.braking ? 4.5 : 1.3
    for (const m of this.tailMats) m.emissiveIntensity = tail

    const wheelRotationDelta = (this.speed * dt) / this.wheelRadius
    for (const wheel of this.wheels) {
      wheel.rotation.x -= wheelRotationDelta
    }
    const steerAngle = steerInput * 0.35
    for (const fw of this.frontWheels) {
      fw.rotation.y = THREE.MathUtils.lerp(fw.rotation.y, steerAngle, 0.2)
    }
  }

  private stepSprings(dt: number, targetPitch: number, targetRoll: number, speedRatio: number): void {
    const K = 140 // stiffness
    const C = 15  // damping (a bit under critical → one small overshoot)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h = dt / steps
    for (let s = 0; s < steps; s++) {
      this.pitchV += ((targetPitch - this.pitch) * K - this.pitchV * C) * h
      this.pitch += this.pitchV * h
      this.rollV += ((targetRoll - this.roll) * K - this.rollV * C) * h
      this.roll += this.rollV * h
      this.heaveV += ((0 - this.heave) * K * 1.4 - this.heaveV * C) * h
      this.heave += this.heaveV * h
    }
    // Road texture: tiny random jolts that grow with speed
    const j = Math.min(dt * 60, 2)
    this.heaveV += (Math.random() - 0.5) * speedRatio * 0.35 * j
    this.pitchV += (Math.random() - 0.5) * speedRatio * 0.06 * j
  }

  /** A suspension hit (landing a jump, kerb strike). 0–1. */
  bump(strength: number): void {
    this.heaveV -= strength * 3.2
    this.pitchV += (Math.random() - 0.3) * strength * 0.6
  }

  /**
   * Move the triangles of a lamp mesh that sit behind the car's middle into
   * a sibling mesh with an unlit material (reversing lights stay off).
   */
  private splitRearLamps(mesh: THREE.Mesh): void {
    const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    const pos = src.getAttribute('position')
    const toCar = new THREE.Matrix4().copy(this.mesh.matrixWorld).invert().multiply(mesh.matrixWorld)
    const v = new THREE.Vector3()
    const front: number[] = [], rear: number[] = []
    for (let t = 0; t < pos.count; t += 3) {
      let z = 0
      for (let k = 0; k < 3; k++) z += v.fromBufferAttribute(pos, t + k).applyMatrix4(toCar).z
      ;(z / 3 > 0 ? rear : front).push(t)
    }
    if (!rear.length || !front.length) return
    const pick = (tris: number[]) => {
      const g = new THREE.BufferGeometry()
      for (const name of Object.keys(src.attributes)) {
        const a = src.getAttribute(name)
        const out = new Float32Array(tris.length * 3 * a.itemSize)
        let o = 0
        for (const t of tris) for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) out[o++] = a.getComponent(t + k, c)
        g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize))
      }
      return g
    }
    const rev = (mesh.material as THREE.MeshStandardMaterial).clone()
    rev.color.set(0xdddddd)
    rev.emissive.set(0x000000)
    const rearMesh = new THREE.Mesh(pick(rear), rev)
    rearMesh.castShadow = mesh.castShadow
    mesh.geometry = pick(front)
    mesh.parent?.add(rearMesh)
    rearMesh.position.copy(mesh.position)
    rearMesh.quaternion.copy(mesh.quaternion)
    rearMesh.scale.copy(mesh.scale)
  }

  private findWheelsByShape(model: THREE.Object3D, out: THREE.Object3D[]): void {
    this.mesh.updateMatrixWorld(true)
    const body = new THREE.Box3().setFromObject(model, true)
    const lo = this.mesh.worldToLocal(body.min.clone()), hi = this.mesh.worldToLocal(body.max.clone())
    const halfW = Math.abs(hi.x - lo.x) / 2, halfL = Math.abs(hi.z - lo.z) / 2, bottom = Math.min(lo.y, hi.y)
    type Cand = { o: THREE.Object3D; c: THREE.Vector3; d: number }
    const cands: Cand[] = []
    model.traverse((o) => {
      if (o === model) return
      const b = new THREE.Box3().setFromObject(o, true)
      if (b.isEmpty()) return
      const a = this.mesh.worldToLocal(b.min.clone()), z = this.mesh.worldToLocal(b.max.clone())
      const sx = Math.abs(z.x - a.x), sy = Math.abs(z.y - a.y), sz = Math.abs(z.z - a.z)
      const c = new THREE.Vector3((a.x + z.x) / 2, (a.y + z.y) / 2, (a.z + z.z) / 2)
      const round = sy > 0.35 && sy < 1.1 && Math.abs(sy - sz) < sy * 0.3 && sx < sy * 0.9
      const low = Math.min(a.y, z.y) < bottom + 0.15
      const corner = Math.abs(c.x) > halfW * 0.45 && Math.abs(c.z) > halfL * 0.35
      if (round && low && corner) cands.push({ o, c, d: sy })
    })
    // One per corner: keep the biggest candidate in each quadrant, prefer
    // parents (a wheel group) over their own child meshes
    const best = new Map<string, Cand>()
    for (const k of cands) {
      const q = `${Math.sign(k.c.x)},${Math.sign(k.c.z)}`
      const cur = best.get(q)
      const isAncestor = cur && cur.o !== k.o && (() => { let p = cur.o.parent; while (p) { if (p === k.o) return true; p = p.parent } return false })()
      if (!cur || isAncestor || (k.d > cur.d * 1.05 && !k.o.children.includes(cur.o))) best.set(q, k)
    }
    if (best.size !== 4) return
    for (const { o, c } of best.values()) {
      // tag the front pair so the steering + facing logic finds them
      // (the shape-detected HQ model's nose points +Z, so its +Z pair is the
      // front; the "face -Z" step below then spins it round)
      if (c.z > 0) o.name = `${o.name}_front_wheel`
      else o.name = `${o.name}_rear_wheel`
      out.push(o)
    }
  }

  /** Body heave (m) and pitch (rad) from the suspension, for the camera. */
  getBodyHeave(): number { return this.heave }
  getBodyPitch(): number { return this.pitch }

  /** Sideways slip 0 (full grip) … 1 (fully sideways). */
  getSlip(): number {
    // Visible sideways slide, or a hard sustained corner (tyres at their limit)
    const cornering = THREE.MathUtils.clamp((this.load - 0.45) / 0.45, 0, 1) * 0.55
    return Math.max(this.slip * 4, cornering)
  }

  private reflection: THREE.Texture | null = null

  /**
   * Live reflection cubemap of the car's surroundings (or null for the sky
   * only). Applied to every car material, including a swapped-in model.
   */
  setReflection(tex: THREE.Texture | null): void {
    this.reflection = tex
    this.mesh.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        if (!(m instanceof THREE.MeshStandardMaterial) || m.envMap === tex) continue
        m.envMap = tex
        m.needsUpdate = true
      }
    })
  }

  /** Handling for the chosen car, on top of the standard set-up. */
  setStats(stats: Partial<CarConfig>): void {
    Object.assign(this.config, CAR_CONFIG, stats)
  }

  /**
   * Merge the whole car into a few meshes: a rival costs a handful of draw
   * calls instead of dozens. Its wheels stop turning, which nobody sees at speed.
   */
  bake(): void {
    this.mesh.remove(this.flame)
    this.mesh.rotation.set(0, 0, 0)
    this.mesh.position.set(0, 0, 0)
    this.mesh.updateMatrixWorld(true)
    // the wheels stay separate so they can turn; everything else becomes a few meshes
    const spinners = this.wheels.map((w) => ({ w, parent: w.parent! }))
    for (const s of spinners) s.parent.remove(s.w)
    const merged = AssetLoader.flatten(this.bodyGroup, true)
    const keep = new Set(spinners.map((s) => s.parent))
    for (const c of [...this.bodyGroup.children]) if (!keep.has(c)) this.bodyGroup.remove(c)
    for (const s of spinners) s.parent.add(s.w)
    this.bodyGroup.add(merged)
  }

  /** Body colour (the player's chosen paint). */
  setPaint(hex: number): void {
    this.paint = hex
    for (const m of this.paintMats) m.color.set(hex)
  }

  /** Headlight strength 0–1 (time of day decides). */
  setHeadlights(level: number): void {
    this.headlightLevel = level
    // Beam: brighter and longer-reaching when it's really dark
    if (this.headlight) {
      this.headlight.intensity = level * 140
      this.headlight.distance = 55 + level * 45
    }
    for (const m of this.headMats) m.emissiveIntensity = 1.2 + level * 5
  }

  /** Slope pitch from the track tangent (applied by the game). */
  setSlopePitch(pitch: number, lerp = 0.15): void {
    this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, pitch, lerp)
  }

  /** Direct pose control for the flight autopilot (scripted ramp jumps). */
  setPose(position: THREE.Vector3, heading: number): void {
    this.position.copy(position)
    this.heading = heading
    this.mesh.position.copy(position)
    this.mesh.rotation.y = heading
  }

  /** Spin the wheels by a travelled distance (visual only, used in flight). */
  spinWheels(distance: number): void {
    const delta = distance / this.wheelRadius
    for (const wheel of this.wheels) wheel.rotation.x -= delta
  }

  /**
   * Swap the procedural body for a loaded GLB. Keeps the physics untouched:
   * the model's own wheels are hidden and replaced with our procedural
   * spinning/steering wheels placed at the model's wheel positions, so
   * roll/pitch/steer/spin all keep working. Falls back silently if the model
   * looks unusable.
   */
  applyModel(model: THREE.Group, targetLength = 4.5, rideRaise = 0, keepMaterials = false): void {
    // ─── Clear the procedural body + wheels ───
    this.tailMats.length = 0
    this.headMats.length = 0
    this.paintMats.length = 0
    while (this.bodyGroup.children.length) this.bodyGroup.remove(this.bodyGroup.children[0]!)
    // front wheels sit in a steering group: without this the old car's wheels stay on
    for (const w of this.frontWheels) this.mesh.remove(w)
    for (const w of this.wheels) this.mesh.remove(w)
    this.wheels.length = 0
    this.frontWheels.length = 0

    // ─── Parent FIRST, with the mesh at heading 0, so the world bounding box
    // is axis-aligned to the model's own width/length. (Measuring while the
    // mesh carried the spawn heading rotated the AABB and made the "is it
    // wider than long" test — and the 90° correction — misfire, leaving the
    // car sideways.) The real heading is restored by the next update/reset. ─
    this.bodyGroup.rotation.set(0, 0, 0)
    this.mesh.rotation.set(0, 0, 0)
    model.position.set(0, 0, 0)
    model.rotation.set(0, 0, 0)
    model.scale.set(1, 1, 1)
    // Some exports carry wrong bounding boxes (one Sketchfab RX-7 reported
    // its body 4× too tall, which floated the car 1.5 m above the road):
    // recompute every box from the real vertices before measuring anything.
    model.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.geometry.computeBoundingBox()
      m.geometry.computeBoundingSphere()
      // without normals the lighting gives NaN pixels, and the glow pass spreads them into black squares
      if (!m.geometry.getAttribute('normal')) m.geometry.computeVertexNormals()
    })
    this.bodyGroup.add(model)
    this.mesh.updateMatrixWorld(true)
    let box = new THREE.Box3().setFromObject(model, true)
    const size = new THREE.Vector3()
    box.getSize(size)

    // Longest horizontal axis becomes the car's length (Z). Rotate if along X.
    if (size.x > size.z) {
      model.rotation.y = Math.PI / 2
      this.mesh.updateMatrixWorld(true)
      box = new THREE.Box3().setFromObject(model, true)
      box.getSize(size)
    }
    const scale = targetLength / Math.max(size.z, 0.001)
    model.scale.setScalar(scale)
    this.mesh.updateMatrixWorld(true)
    // Centre the body on the car's origin (many models have an offset pivot)
    {
      const b = new THREE.Box3().setFromObject(model, true)
      const c = this.mesh.worldToLocal(b.getCenter(new THREE.Vector3()))
      model.position.x -= c.x
      model.position.z -= c.z
      this.mesh.updateMatrixWorld(true)
    }

    // ─── Wheel ROOT nodes: name matches "wheel" but parent doesn't ───
    // (avoids matching auto-generated "-Mesh" child nodes twice)
    const wheelRoots: THREE.Object3D[] = []
    model.traverse((o) => {
      if (!/wheel/i.test(o.name) || /steer/i.test(o.name)) return
      if (o.parent && /wheel/i.test(o.parent.name)) return
      wheelRoots.push(o)
    })
    // No parts named "wheel" (common on Sketchfab exports): find the four
    // wheels by shape — round (height ≈ length), wheel-sized, low, at the corners
    if (wheelRoots.length === 0) this.findWheelsByShape(model, wheelRoots)
    const centerOf = (o: THREE.Object3D): THREE.Vector3 => {
      const c = new THREE.Vector3()
      new THREE.Box3().setFromObject(o, true).getCenter(c)
      return this.mesh.worldToLocal(c)
    }

    // Front-wheel name patterns: "front", or fl/fr abbreviations (_fl, fr_, etc.)
    const isFrontWheel = (nm: string) => /front|[_.\b]f[lr]|f[lr][_.\b]/i.test(nm)

    // ─── Face -Z: if front wheels sit at +Z, spin the model 180° ───
    const frontRoots = wheelRoots.filter((o) => isFrontWheel(o.name))
    const avgFrontZ = frontRoots.length
      ? frontRoots.reduce((a, o) => a + centerOf(o).z, 0) / frontRoots.length
      : -1
    if (avgFrontZ > 0) {
      model.rotation.y += Math.PI
      this.mesh.updateMatrixWorld(true)
      // Spinning about the model's own pivot moves an offset body off centre
      // again — re-centre it so the car sits (and turns) on the car's origin
      const b = new THREE.Box3().setFromObject(model, true)
      const c = this.mesh.worldToLocal(b.getCenter(new THREE.Vector3()))
      model.position.x -= c.x
      model.position.z -= c.z
      this.mesh.updateMatrixWorld(true)
    }

    // ─── Materials. A realistic (HQ) model keeps its own authored PBR
    // materials; the low-poly wedge gets real car paint, glass and rubber. ───
    const paint = createCarPaint()
    paint.color.set(this.paint)
    this.paintMats.push(paint)
    const glass = createCarGlass()
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true
      o.receiveShadow = true
      if (keepMaterials) {
        const ms = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of ms) {
          if (!(m instanceof THREE.MeshStandardMaterial)) continue
          m.envMapIntensity = 1
          // the HQ model's body shell ships near-black: give it a colour that reads on a dark road
          if (m.name === 'Material.007' || /^paint/i.test(m.name)) { m.color.set(this.paint); m.metalness = 0.45; m.roughness = 0.3; m.map = null; this.paintMats.push(m) }
          // "Transmission" glass makes three.js render the whole scene a
          // second time every frame (~23 ms on a laptop GPU). Plain
          // transparency looks the same on small lamp lenses and windows.
          const phys = m as THREE.MeshPhysicalMaterial
          if (phys.isMeshPhysicalMaterial && phys.transmission > 0) {
            phys.transmission = 0
            phys.transparent = true
            phys.opacity = Math.min(phys.opacity, 0.35)
            phys.depthWrite = false
          }
          // Brake lights on realistic models: match by common material names
          if (/head.?light|front.?light|headlamp/i.test(m.name)) {
            if (m.emissive.r + m.emissive.g + m.emissive.b < 0.1) m.emissive.set(0xfff4e0)
            this.headMats.push(m)
          }
          if (/brake|tail|rear.?light|stop/i.test(m.name)) {
            if (m.emissive.r + m.emissive.g + m.emissive.b < 0.1) m.emissive.set(0xff1a00)
            this.tailMats.push(m)
          }
        }
        return
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      const swapped = mats.map((mat) => {
        if (!(mat instanceof THREE.MeshStandardMaterial)) return mat
        const name = mat.name.toLowerCase()
        mat.envMapIntensity = 1
        const isRedLight = name.includes('taillight') || name.includes('ambar') ||
          name.includes('amber') || (name.includes('red') && name.includes('light'))
        const isHeadLight = name.includes('headlight') ||
          (name.includes('yellow') && name.includes('light'))
        const isTire = name.includes('tire') || name.includes('tyre') || name.includes('wheel')
        if (isRedLight) {
          mat.color.set(0xff3300); mat.emissive.set(0xff2200); mat.emissiveIntensity = 2.2
          this.tailMats.push(mat)
          return mat
        }
        if (isHeadLight) {
          mat.color.set(0xffffff); mat.emissive.set(0xfff4e0); mat.emissiveIntensity = 1.6
          this.headMats.push(mat)
          return mat
        }
        if (name.includes('window') || name.includes('glass')) return glass
        if (isTire) {
          mat.color.set(0x111113); mat.roughness = 0.88; mat.metalness = 0
          mat.emissive.set(0x000000)
          return mat
        }
        // Everything else = the body shell. Keyword matching can't be trusted
        // on free models (it missed the DeLorean body), so paint it all.
        return paint
      })
      o.material = Array.isArray(o.material) ? swapped : swapped[0]!
    })

    // ─── Realistic models with generic material names: find the lamps by
    // where and what colour they are. A material counts only if EVERY mesh
    // using it sits at the very back (red → brake lights) or the very front
    // (bright / glass → headlights), so body paint never lights up. ───
    if (keepMaterials && (!this.tailMats.length || !this.headMats.length)) {
      this.mesh.updateMatrixWorld(true)
      const body = new THREE.Box3().setFromObject(model, true)
      const halfL = (body.max.z - body.min.z) / 2
      const zones = new Map<THREE.MeshStandardMaterial, number[]>()
      model.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh || Array.isArray(m.material) || !(m.material instanceof THREE.MeshStandardMaterial)) return
        const c = this.mesh.worldToLocal(new THREE.Box3().setFromObject(m, true).getCenter(new THREE.Vector3()))
        const list = zones.get(m.material) ?? []
        list.push(c.z / halfL)
        zones.set(m.material, list)
      })
      for (const [mat, zs] of zones) {
        const c = mat.color
        const rearOnly = zs.every((z) => z > 0.7)
        if (rearOnly && c.r > 0.25 && c.r > c.g * 1.6) {
          mat.emissive.set(0xff1a00)
          this.tailMats.push(mat)
        } else if (rearOnly && mat.map) {
          // Textured lamp cluster: glow red through its own texture
          mat.emissive.set(0xff2a10)
          mat.emissiveMap = mat.map
          mat.needsUpdate = true
          this.tailMats.push(mat)
        } else if (!this.headMats.length && zs.every((z) => z < -0.7) && (mat.transparent || c.r + c.g + c.b > 2.2)) {
          mat.emissive.set(0xfff4e0)
          this.headMats.push(mat)
        }
      }
    }

    // ─── Free models often merge every white lamp into one mesh, front and
    // back. Split those meshes so only the nose lamps glow as headlights. ───
    if (this.headMats.length) {
      const lampMeshes: THREE.Mesh[] = []
      model.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && !Array.isArray(m.material) && this.headMats.includes(m.material as THREE.MeshStandardMaterial)) lampMeshes.push(m)
      })
      this.mesh.updateMatrixWorld(true)
      for (const m of lampMeshes) this.splitRearLamps(m)
    }

    // ─── Ride height: drop the model so its lowest point sits on the road ───
    this.mesh.updateMatrixWorld(true)
    const finalBox = new THREE.Box3().setFromObject(model, true)
    const minLocal = this.mesh.worldToLocal(finalBox.min.clone())
    model.position.y -= minLocal.y - rideRaise
    this.mesh.updateMatrixWorld(true)

    // ─── Reparent the model's own wheels into spin (+ steer) pivots so they
    // roll and steer while staying part of the model's silhouette. `attach`
    // preserves each wheel's world transform. Front wheels get a steer group
    // (yaw) wrapping a spin group (roll); rear wheels just spin. ───
    // Tyres and rims never take the body paint
    if (!keepMaterials) {
      const rubber = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.62, metalness: 0.55 })
      for (const w of wheelRoots) w.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && m.material === paint) m.material = rubber
      })
    }

    // A wheel is often several parts (tyre, rim, brake disc). They must all turn
    // about one hub, or they wobble round their own centres: one pivot per corner.
    let radiusSum = 0
    const corners = new Map<string, THREE.Object3D[]>()
    for (const w of wheelRoots) {
      const c = centerOf(w)
      const key = `${Math.sign(c.x)},${Math.sign(c.z)}`
      const list = corners.get(key) ?? []
      list.push(w)
      corners.set(key, list)
    }
    for (const parts of corners.values()) {
      const box = new THREE.Box3()
      for (const w of parts) box.union(new THREE.Box3().setFromObject(w, true))
      const center = this.mesh.worldToLocal(box.getCenter(new THREE.Vector3()))
      const size2 = box.getSize(new THREE.Vector3())
      radiusSum += Math.max(size2.y, 0.2) / 2
      const isFront = center.z < 0

      const spin = new THREE.Group()
      if (isFront) {
        const steer = new THREE.Group()
        steer.position.copy(center)
        this.mesh.add(steer)
        steer.add(spin)
        this.frontWheels.push(steer)
      } else {
        spin.position.copy(center)
        this.mesh.add(spin)
      }
      this.mesh.updateMatrixWorld(true)
      for (const w of parts) spin.attach(w) // keeps world transform; now turns about the hub
      this.wheels.push(spin)
    }
    if (corners.size > 0) this.wheelRadius = radiusSum / corners.size
    this.setHeadlights(this.headlightLevel) // new model's lamp materials follow day/night
    this.setReflection(this.reflection)

    // Put the nitro flames at the back of the new body, near the bottom
    this.mesh.updateMatrixWorld(true)
    const body = new THREE.Box3().setFromObject(model, true)
    const lo = this.mesh.worldToLocal(body.min.clone())
    const hi = this.mesh.worldToLocal(body.max.clone())
    this.flame.position.set(0, Math.min(lo.y, hi.y) + 0.3, Math.max(lo.z, hi.z) + 0.02)
  }

  /** Set speed + align momentum with the heading (seamless flight exit). */
  setSpeed(speed: number): void {
    this.speed = speed
    this._forwardDir.set(-Math.sin(this.heading), 0, -Math.cos(this.heading))
    this.velocity.copy(this._forwardDir).multiplyScalar(speed)
  }

  scrubSpeed(factor: number): void {
    this.speed *= factor
    this.velocity.multiplyScalar(factor)
  }

  getSpeed(): number { return this.speed }
  get topSpeed(): number { return this.config.maxSpeed }
  getSpeedMph(): number { return Math.abs(this.speed) * 2.237 }
  getNormalizedSpeed(): number { return Math.abs(this.speed) / this.config.maxSpeed }

  getForwardDir(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading))
  }

  reset(position: THREE.Vector3, heading: number): void {
    this.position.copy(position)
    this.heading = heading
    this.speed = 0
    this.velocity.set(0, 0, 0)
    this.mesh.position.copy(position)
    this.mesh.rotation.set(0, heading, 0)
    this.bodyGroup.rotation.set(0, 0, 0)
    this.bodyGroup.position.y = 0
    this.pitch = this.pitchV = this.roll = this.rollV = this.heave = this.heaveV = 0
    this.slip = 0
    this.load = 0
    this.nitro = 1
    this.launch = 0
    this.steerIn = 0
    this.drifting = false
    this.boosting = false
    this.flame.visible = false
    this.braking = false
  }
}
