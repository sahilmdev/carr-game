import * as THREE from 'three'

const STEP = 0.05 // seconds between recorded poses
const STRIDE = 8 // t, x, y, z, qx, qy, qz, qw

/**
 * Your best lap on a track, replayed as a see-through car you race against
 * every lap (single races only). Laps are recorded as you drive; a faster
 * one replaces the saved ghost, which is kept in the browser per track.
 */
export class LapGhost {
  readonly mesh = new THREE.Group()
  private rec: number[] = []
  private recT = -1
  private best: Float32Array | null = null
  private bestMs = Infinity
  private readonly key: string
  private readonly _q = new THREE.Quaternion()
  private readonly _q2 = new THREE.Quaternion()

  constructor(trackId: string) {
    this.key = `nc-ghost-${trackId}`
    this.mesh.visible = false
    try {
      const raw = localStorage.getItem(this.key)
      if (raw) {
        const j = JSON.parse(raw) as { ms: number; d: number[] }
        if (j.ms > 0 && j.d.length >= STRIDE * 4) { this.best = Float32Array.from(j.d); this.bestMs = j.ms }
      }
    } catch { /* storage blocked or corrupt: no ghost */ }
  }

  get hasGhost(): boolean { return !!this.best }

  /** Take the player's car body as the ghost's shape: see-through, cool blue, no lights. */
  setLook(car: THREE.Object3D): void {
    while (this.mesh.children.length) this.mesh.remove(this.mesh.children[0]!)
    const mat = new THREE.MeshBasicMaterial({ color: 0x7ad8ff, transparent: true, opacity: 0.28, depthWrite: false })
    const copy = car.clone(true)
    const drop: THREE.Object3D[] = []
    copy.traverse((o) => {
      if ((o as THREE.Sprite).isSprite || (o as THREE.Light).isLight || o.name === 'beam') { drop.push(o); return }
      const m = o as THREE.Mesh
      if (m.isMesh) { m.material = mat; m.castShadow = false; m.receiveShadow = false }
    })
    for (const o of drop) o.parent?.remove(o)
    copy.position.set(0, 0, 0)
    copy.rotation.set(0, 0, 0)
    this.mesh.add(copy)
  }

  /** A new lap began: start recording afresh. */
  lapStarted(): void {
    this.rec = []
    this.recT = -1
  }

  /** Record the car's pose `t` seconds into the lap. */
  record(t: number, car: THREE.Object3D): void {
    if (t - this.recT < STEP) return
    this.recT = t
    const p = car.position, q = car.quaternion
    this.rec.push(t, p.x, p.y, p.z, q.x, q.y, q.z, q.w)
  }

  /** A lap done in `ms`: keep it if it's the best yet (and long enough to be a real lap). */
  lapDone(ms: number): void {
    if (ms < this.bestMs && this.rec.length >= STRIDE * 40) {
      this.best = Float32Array.from(this.rec)
      this.bestMs = ms
      try { localStorage.setItem(this.key, JSON.stringify({ ms, d: Array.from(this.best, (v) => Math.round(v * 100) / 100) })) } catch { /* storage full or blocked */ }
    }
    this.lapStarted()
  }

  /** Put the ghost where it was `t` seconds into its lap; hidden once its lap is over. */
  show(t: number, on: boolean): void {
    const d = this.best
    if (!on || !d || t < 0 || t > d[d.length - STRIDE]!) { this.mesh.visible = false; return }
    // binary search for the pose just before t
    let lo = 0, hi = d.length / STRIDE - 1
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (d[mid * STRIDE]! <= t) lo = mid; else hi = mid }
    const a = lo * STRIDE, b = hi * STRIDE
    const u = THREE.MathUtils.clamp((t - d[a]!) / Math.max(1e-4, d[b]! - d[a]!), 0, 1)
    this.mesh.position.set(d[a + 1]! + (d[b + 1]! - d[a + 1]!) * u, d[a + 2]! + (d[b + 2]! - d[a + 2]!) * u, d[a + 3]! + (d[b + 3]! - d[a + 3]!) * u)
    this._q.set(d[a + 4]!, d[a + 5]!, d[a + 6]!, d[a + 7]!)
    this._q2.set(d[b + 4]!, d[b + 5]!, d[b + 6]!, d[b + 7]!)
    this.mesh.quaternion.copy(this._q).slerp(this._q2, u)
    this.mesh.visible = true
  }
}
