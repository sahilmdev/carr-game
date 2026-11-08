import * as THREE from 'three'
import type { Car } from './Car'

/**
 * Physical speed / grip effects around the car:
 *  - tyre smoke from the rear wheels when sliding or braking hard
 *  - dust kicked up when the car runs wide onto the shoulder
 *  - skid marks left on the road while sliding (a fading ring buffer)
 *
 * (Radial motion blur at speed lives in PostProcessing's grade pass.)
 */
export class SpeedEffects {
  private readonly particles: ParticleSystem
  private readonly skids: SkidMarks
  private readonly _fwd = new THREE.Vector3()
  private readonly _right = new THREE.Vector3()
  private readonly _wheel = new THREE.Vector3()
  private readonly _vel = new THREE.Vector3()
  private smokeAcc = 0
  private dustAcc = 0
  private sprayAcc = 0
  private fxAcc = 0
  private chirp = 0
  private smoking = 0
  /** 0 dry … 1 soaked: wet roads throw a mist of spray off the rear tyres. */
  public wetness = 0
  private readonly spray = new THREE.Color()
  /** Lit smoke color: set from the sky so smoke matches the time of day. */
  public readonly smokeColor = new THREE.Color(0xd6d6d2)

  constructor(scene: THREE.Scene) {
    this.particles = new ParticleSystem(460)
    scene.add(this.particles.points)
    this.skids = new SkidMarks(420)
    scene.add(this.skids.mesh)
  }

  /**
   * @param offroad 0–1, how far the car is over the road edge (dust)
   * @param roadY   road height under the car (skid marks sit on it)
   */
  update(car: Car, dt: number, offroad: number, roadY: number): void {
    const speed = Math.abs(car.getSpeed())
    const slip = car.getSlip()
    car.getForwardDir(this._fwd)
    this._right.set(-this._fwd.z, 0, this._fwd.x)

    // Grip loss: sliding sideways, or hard braking at speed
    const brakeSlip = car.braking && speed > 12 ? 0.6 : 0
    const grip = Math.max(THREE.MathUtils.clamp((slip - 0.12) / 0.25, 0, 1), brakeSlip)

    for (const side of [-1, 1]) {
      this._wheel.copy(car.position)
        .addScaledVector(this._fwd, -1.45)
        .addScaledVector(this._right, side * 0.85)
      this._wheel.y = roadY
      this.skids.track(side > 0 ? 1 : 0, this._wheel, this._right, (grip > 0.25 || this.chirp > 0) && speed > 5)
    }

    // Tyre smoke
    this.smokeAcc += grip * speed * dt * 0.9
    while (this.smokeAcc > 1) {
      this.smokeAcc -= 1
      const side = Math.random() < 0.5 ? -1 : 1
      this._wheel.copy(car.position).addScaledVector(this._fwd, -1.6).addScaledVector(this._right, side * 0.85)
      this._wheel.y = roadY + 0.25
      this._vel.copy(this._fwd).multiplyScalar(speed * 0.25).add(new THREE.Vector3(
        (Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 1.5))
      this.particles.emit(this._wheel, this._vel, 1.0 + Math.random() * 0.8, 0.42 * Math.min(1, grip + 0.3), 1.4 + Math.random(), this.smokeColor)
    }

    // Spray: wet road, rooster-tail mist behind each rear tyre at speed
    this.sprayAcc += this.wetness * Math.max(0, speed - 6) * dt * 1.5
    if (this.sprayAcc > 0) this.spray.copy(this.smokeColor).multiplyScalar(1.05)
    while (this.sprayAcc > 1) {
      this.sprayAcc -= 1
      const side = Math.random() < 0.5 ? -1 : 1
      this._wheel.copy(car.position).addScaledVector(this._fwd, -2.0).addScaledVector(this._right, side * 0.85)
      this._wheel.y = roadY + 0.3
      this._vel.copy(this._fwd).multiplyScalar(speed * 0.55).add(new THREE.Vector3(
        (Math.random() - 0.5) * 2.5 + this._right.x * side * 1.5, 1.2 + Math.random() * 1.6, (Math.random() - 0.5) * 2.5 + this._right.z * side * 1.5))
      this.particles.emit(this._wheel, this._vel, 0.7 + Math.random() * 0.6, 0.2, 0.6 + Math.random() * 0.4, this.spray)
    }

    // Dust off the road edge
    this.dustAcc += offroad * speed * dt * 1.1
    while (this.dustAcc > 1) {
      this.dustAcc -= 1
      const side = Math.random() < 0.5 ? -1 : 1
      this._wheel.copy(car.position).addScaledVector(this._fwd, -1.8).addScaledVector(this._right, side * 1.0)
      this._wheel.y = roadY + 0.2
      this._vel.copy(this._fwd).multiplyScalar(speed * 0.35).add(new THREE.Vector3(
        (Math.random() - 0.5) * 2, 0.8 + Math.random() * 1.2, (Math.random() - 0.5) * 2))
      this.particles.emit(this._wheel, this._vel, 2 + Math.random() * 1.5, 0.45, 2.2 + Math.random(), DUST)
    }

    this.chirp = Math.max(0, this.chirp - dt)
    // a damaged car trails smoke for a while
    if (this.smoking > 0) {
      this.smoking -= dt
      this.fxAcc += dt * 26
      while (this.fxAcc > 1) {
        this.fxAcc -= 1
        this._vel.set((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2)
        this._wheel.copy(car.position).addScaledVector(this._fwd, 1.5).setY(car.position.y + 0.9)
        this.particles.emit(this._wheel, this._vel, 1.1, 0.5, 1.5, SOOT)
      }
    }
    this.particles.update(dt)
    this.skids.update(dt)
  }

  /** Sparks off a wall: at the side of the car nearest the barrier. */
  sparks(at: THREE.Vector3, dir: THREE.Vector3, count: number): void {
    for (let k = 0; k < count; k++) {
      this._vel.copy(dir).multiplyScalar(0.5 + Math.random() * 0.7)
      this._vel.x += (Math.random() - 0.5) * 16
      this._vel.y = 2 + Math.random() * 9
      this._vel.z += (Math.random() - 0.5) * 16
      this.particles.emit(at, this._vel, 0.11 + Math.random() * 0.1, 1, 0.22 + Math.random() * 0.3, Math.random() < 0.5 ? SPARK : SPARK2)
    }
  }

  /** Touch-down: a ring of dust, sparks off the floor and a chirp of rubber. */
  landing(car: Car, strength: number, ground: THREE.Color): void {
    const p = car.position
    const count = Math.round(10 + strength * 16)
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2
      this._vel.set(Math.cos(a) * 10 * strength, 0.8 + Math.random() * 1.6, Math.sin(a) * 10 * strength)
      this._wheel.set(p.x + Math.cos(a) * 1.4, p.y + 0.25, p.z + Math.sin(a) * 2)
      this.particles.emit(this._wheel, this._vel, 1 + Math.random() * 0.8, 0.5, 0.9 + Math.random() * 0.5, ground)
    }
    car.getForwardDir(this._fwd)
    this.sparks(this._wheel.copy(p).setY(p.y + 0.15), this._vel.copy(this._fwd).multiplyScalar(-14), Math.round(8 + strength * 14))
    this.chirp = 0.25
  }

  /** A big hit: a fireball of sparks and soot, and the car smokes afterwards. */
  crash(car: Car, smokeFor: number): void {
    const p = car.position
    this.sparks(this._wheel.copy(p).setY(p.y + 0.8), this._vel.set(0, 0, 0), 40)
    for (let k = 0; k < 18; k++) {
      this._vel.set((Math.random() - 0.5) * 12, 3 + Math.random() * 7, (Math.random() - 0.5) * 12)
      this.particles.emit(this._wheel.copy(p).setY(p.y + 1), this._vel, 1.8 + Math.random() * 1.6, 0.7, 1.6, k % 3 ? SOOT : FIRE)
    }
    this.smoking = Math.max(this.smoking, smokeFor)
  }

  clear(): void {
    this.smoking = 0
    this.particles.clear()
    this.skids.clear()
  }
}

const SPARK = new THREE.Color(5, 2.6, 0.8)
const SPARK2 = new THREE.Color(4, 3.4, 2)
const SOOT = new THREE.Color(0.09, 0.08, 0.08)
const FIRE = new THREE.Color(1.1, 0.42, 0.12)

const DUST = new THREE.Color(0xa08a6a)

// ── Soft billboard particles ──────────────────────────────────────────

class ParticleSystem {
  public readonly points: THREE.Points
  private readonly pos: Float32Array
  private readonly vel: Float32Array
  private readonly age: Float32Array
  private readonly life: Float32Array
  private readonly size: Float32Array
  private readonly startSize: Float32Array
  private readonly alpha: Float32Array
  private readonly startAlpha: Float32Array
  private readonly color: Float32Array
  private next = 0

  constructor(private readonly max: number) {
    this.pos = new Float32Array(max * 3).fill(-9999)
    this.vel = new Float32Array(max * 3)
    this.age = new Float32Array(max).fill(1)
    this.life = new Float32Array(max).fill(1)
    this.size = new Float32Array(max)
    this.startSize = new Float32Array(max)
    this.alpha = new Float32Array(max)
    this.startAlpha = new Float32Array(max)
    this.color = new Float32Array(max * 3)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1))
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1))
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3))
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aAlpha;
        attribute vec3 aColor;
        uniform float uScale;
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          vAlpha = aAlpha;
          vColor = aColor;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        varying vec3 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length(d);
          float a = smoothstep(0.5, 0.05, r) * vAlpha;
          if (a < 0.01) discard;
          // slightly darker toward the bottom of each puff (self-shadow)
          vec3 c = vColor * (0.82 + 0.18 * (1.0 - gl_PointCoord.y));
          gl_FragColor = vec4(c, a);
        }
      `,
    })
    this.points = new THREE.Points(geo, mat)
    this.points.frustumCulled = false
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, size: number, alpha: number, life: number, color: THREE.Color): void {
    const i = this.next
    this.next = (this.next + 1) % this.max
    this.pos.set([p.x, p.y, p.z], i * 3)
    this.vel.set([v.x, v.y, v.z], i * 3)
    this.age[i] = 0
    this.life[i] = life
    this.startSize[i] = size
    this.startAlpha[i] = alpha
    this.color.set([color.r, color.g, color.b], i * 3)
  }

  update(dt: number): void {
    const drag = Math.pow(0.25, dt)
    for (let i = 0; i < this.max; i++) {
      if (this.age[i]! >= this.life[i]!) { this.alpha[i] = 0; continue }
      this.age[i]! += dt
      const t = this.age[i]! / this.life[i]!
      for (let c = 0; c < 3; c++) {
        this.vel[i * 3 + c]! *= drag
        this.pos[i * 3 + c]! += this.vel[i * 3 + c]! * dt
      }
      this.vel[i * 3 + 1]! += 0.6 * dt // smoke rises
      this.size[i] = this.startSize[i]! * (1 + t * 2.5) // and spreads
      this.alpha[i] = this.startAlpha[i]! * (1 - t) * Math.min(1, t * 8)
    }
    const g = this.points.geometry
    g.getAttribute('position').needsUpdate = true
    g.getAttribute('aSize').needsUpdate = true
    g.getAttribute('aAlpha').needsUpdate = true
    g.getAttribute('aColor').needsUpdate = true
  }

  clear(): void {
    this.age.fill(1)
    this.life.fill(1)
    this.alpha.fill(0)
    this.points.geometry.getAttribute('aAlpha').needsUpdate = true
  }
}

// ── Skid marks: per-wheel strips in a ring buffer of quads ────────────

class SkidMarks {
  public readonly mesh: THREE.Mesh
  private readonly pos: Float32Array
  private readonly col: Float32Array
  private readonly ages: Float32Array
  private readonly last: (THREE.Vector3 | null)[] = [null, null]
  private readonly lastR: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()]
  private next = 0
  private readonly LIFE = 14 // seconds before a mark fully fades

  constructor(private readonly max: number) {
    this.pos = new Float32Array(max * 4 * 3).fill(-9999)
    this.col = new Float32Array(max * 4 * 4)
    this.ages = new Float32Array(max).fill(999)
    const idx: number[] = []
    for (let q = 0; q < max; q++) {
      const b = q * 4
      idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4))
    geo.setIndex(idx)
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }

  /** Feed a wheel contact point each frame; draws while `active`. */
  track(wheel: number, p: THREE.Vector3, right: THREE.Vector3, active: boolean): void {
    const prev = this.last[wheel]
    if (!active) { this.last[wheel] = null; return }
    if (prev && prev.distanceToSquared(p) < 0.25) return // segment ~0.5 m
    if (prev && prev.distanceToSquared(p) < 16) {
      const q = this.next
      this.next = (this.next + 1) % this.max
      const w = 0.14
      const r0 = this.lastR[wheel]!, r1 = right
      const y = p.y + 0.035
      const v = [
        prev.x - r0.x * w, y, prev.z - r0.z * w,
        prev.x + r0.x * w, y, prev.z + r0.z * w,
        p.x - r1.x * w, y, p.z - r1.z * w,
        p.x + r1.x * w, y, p.z + r1.z * w,
      ]
      this.pos.set(v, q * 12)
      this.ages[q] = 0
    }
    this.last[wheel] = (prev ?? new THREE.Vector3()).copy(p)
    this.lastR[wheel]!.copy(right)
  }

  update(dt: number): void {
    for (let q = 0; q < this.max; q++) {
      if (this.ages[q]! > this.LIFE) continue
      this.ages[q]! += dt
      const a = 0.55 * (1 - Math.min(1, this.ages[q]! / this.LIFE))
      for (let k = 0; k < 4; k++) this.col.set([0.03, 0.03, 0.03, a], (q * 4 + k) * 4)
    }
    this.mesh.geometry.getAttribute('position').needsUpdate = true
    this.mesh.geometry.getAttribute('color').needsUpdate = true
  }

  clear(): void {
    this.pos.fill(-9999)
    this.ages.fill(999)
    this.col.fill(0)
    this.last[0] = this.last[1] = null
    this.mesh.geometry.getAttribute('position').needsUpdate = true
    this.mesh.geometry.getAttribute('color').needsUpdate = true
  }
}
