import * as THREE from 'three'

const KEY = 'horizon-drive-ghost'
const STEP_MS = 100
const STRIDE = 8 // x, y, z, qx, qy, qz, qw, pad

/**
 * Ghost car: records your lap (position + orientation every 0.1 s) and
 * replays your best one as a translucent car you race against. The best
 * lap is kept in the browser, tied to the track so an edited track can't
 * replay a ghost that drives through walls.
 */
export class Ghost {
  readonly mesh = new THREE.Group()
  private rec: number[] = []
  private best: Float32Array | null = null
  private bestMs = Infinity
  private lastRec = -1
  private built = false
  /** Menu option: race a ghost at all. */
  enabled = true
  private pace: Float32Array | null = null
  private readonly _q = new THREE.Quaternion()
  private readonly _q2 = new THREE.Quaternion()

  constructor(private readonly trackSig: string) {
    this.mesh.visible = false
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const j = JSON.parse(raw) as { sig: string; ms: number; d: number[] }
        if (j.sig === trackSig) { this.best = Float32Array.from(j.d); this.bestMs = j.ms }
      }
    } catch { /* storage blocked or corrupt */ }
  }

  /** A rival for players with no saved lap: the road's centre line at a steady pace. */
  buildPace(track: { samples: THREE.Vector3[]; tangents: THREE.Vector3[]; ups: THREE.Vector3[] }, speed: number): void {
    const n = track.samples.length, out: number[] = []
    const r = new THREE.Vector3(), z = new THREE.Vector3(), m = new THREE.Matrix4(), q = new THREE.Quaternion()
    let i = 0, along = 0
    const step = speed * STEP_MS / 1000
    while (i < n - 1) {
      const a = track.samples[i]!, b = track.samples[i + 1]!, seg = a.distanceTo(b)
      if (along > seg) { along -= seg; i++; continue }
      const t = track.tangents[i]!, u = track.ups[i]!
      r.crossVectors(t, u).normalize()
      z.copy(t).negate()
      q.setFromRotationMatrix(m.makeBasis(r, u, z))
      const p = a.clone().lerp(b, seg > 0 ? along / seg : 0)
      out.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, 0)
      along += step
    }
    this.pace = Float32Array.from(out)
  }

  /** Copy the car's look once (lights stripped, see-through blue). */
  private build(car: THREE.Object3D): void {
    this.built = true
    const copy = car.clone(true)
    const remove: THREE.Object3D[] = []
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.3, depthWrite: false })
    copy.traverse((o) => {
      // a cloned light would change the light count and rebuild every shader
      if ((o as THREE.Light).isLight) remove.push(o)
      const m = o as THREE.Mesh
      if (m.isMesh) { m.material = mat; m.castShadow = false; m.receiveShadow = false }
    })
    for (const o of remove) o.parent?.remove(o)
    copy.position.set(0, 0, 0)
    copy.rotation.set(0, 0, 0)
    this.mesh.add(copy)
  }

  /** A new lap starts: begin recording. */
  startLap(car: THREE.Object3D): void {
    if (!this.built) this.build(car)
    this.rec = []
    this.lastRec = -1
  }

  record(lapMs: number, car: THREE.Object3D): void {
    const k = Math.floor(lapMs / STEP_MS)
    if (k === this.lastRec) return
    this.lastRec = k
    const p = car.position, q = car.quaternion
    this.rec.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, 0)
  }

  /** The lap finished: keep it if it beat the stored ghost. */
  finishLap(lapMs: number): void {
    if (lapMs >= this.bestMs || this.rec.length < STRIDE * 20) return
    this.bestMs = lapMs
    this.best = Float32Array.from(this.rec)
    try {
      localStorage.setItem(KEY, JSON.stringify({ sig: this.trackSig, ms: lapMs, d: this.rec.map((v) => Math.round(v * 1000) / 1000) }))
    } catch { /* storage full or blocked */ }
  }

  /** Pose the ghost at `lapMs` into its best lap (hidden when there is none). */
  update(lapMs: number, racing: boolean): void {
    const b = this.best ?? this.pace
    const frames = b ? b.length / STRIDE : 0
    const f = lapMs / STEP_MS
    const k = Math.floor(f)
    this.mesh.visible = this.enabled && racing && !!b && k < frames - 1
    if (!this.mesh.visible || !b) return
    const t = f - k, a = k * STRIDE, c = (k + 1) * STRIDE
    this.mesh.position.set(b[a]! + (b[c]! - b[a]!) * t, b[a + 1]! + (b[c + 1]! - b[a + 1]!) * t, b[a + 2]! + (b[c + 2]! - b[a + 2]!) * t)
    this._q.set(b[a + 3]!, b[a + 4]!, b[a + 5]!, b[a + 6]!)
    this._q2.set(b[c + 3]!, b[c + 4]!, b[c + 5]!, b[c + 6]!)
    this.mesh.quaternion.slerpQuaternions(this._q, this._q2, t)
  }

  get hasGhost(): boolean {
    return this.best !== null
  }
}
