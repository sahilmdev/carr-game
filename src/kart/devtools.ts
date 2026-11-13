import * as THREE from 'three'
/* Dev-only helpers for checking tracks from the console. Never shipped. */
/* eslint-disable @typescript-eslint/no-explicit-any */
/** Let the page breathe without a timer (a hidden tab clamps timers to a second). */
const yieldNow = (): Promise<void> => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0) })

export function install(app: unknown): void {
  const k = app as any
  const w = window as any
  w.__app = k
  /** Tight bends where a road folds over itself (its two sides cross): [road, i, j, gap]. */
  w.__fold = async (id: string) => {
    await load(id)
    const c = k.circuit, out: number[][] = []
    ;[c, ...c.branches].forEach((a: any, ai: number) => {
      for (let i = 0; i < a.count; i += 2) {
        const p = a.samples[i]
        const step = a.length / a.count
        for (let q = 4; q < 160; q += 2) {
          const j = a === c ? (i + q) % a.count : i + q
          if (j >= a.count) break
          // far enough along the road that the two can't be the same stretch of tarmac
          const w = (a.widths[i] + a.widths[j]) / 2
          if (q * step < w * 1.7) continue
          const s = a.samples[j], chord = Math.hypot(s.x - p.x, s.z - p.z)
          if (chord < w * 0.95 && Math.abs(s.y - p.y) < 6) { out.push([ai, i, j, +(chord - w).toFixed(1)]); break }
        }
      }
    })
    const seen = new Set<string>()
    return out.filter((o) => { const key = o[0] + ':' + Math.round(o[1]! / 30); if (seen.has(key)) return false; seen.add(key); return true })
  }
  /** Places where one road hangs over another (a switchback deck above the lower road). */
  w.__ovl = async (id: string) => {
    await load(id)
    const c = k.circuit, roads = [c, ...c.branches], out: number[][] = []
    roads.forEach((a: any, ai: number) => {
      for (let i = 0; i < a.count; i += 2) {
        const p = a.samples[i]
        roads.forEach((b: any, bi: number) => {
          for (let j = 0; j < b.count; j += 2) {
            if (a === b && Math.abs(i - j) < 40) continue
            const q = b.samples[j], dy = q.y - p.y
            if (dy < 1.5 || dy > 14) continue
            const h = Math.hypot(q.x - p.x, q.z - p.z)
            if (h < (a.widths[i] + b.widths[j]) / 2 + 1) out.push([ai, i, bi, j, +dy.toFixed(1), +h.toFixed(1), Math.round(p.x), Math.round(p.z)])
          }
        })
      }
    })
    const seen = new Set<string>()
    return out.filter((o) => { const key = o[0] + ':' + Math.round(o[1]! / 20); if (seen.has(key)) return false; seen.add(key); return true })
  }
  const load = async (id: string): Promise<void> => {
    await k.settled()
    if (!k.def || k.def.id !== id) { await k.loadTrack(id, true); await k.settled() }
  }
  /** Point the camera at a spot on a track. */
  w.__look = async (id: string, fr: number, o: { back?: number; h?: number; side?: number; ahead?: number; up?: number } = {}) => {
    await load(id)
    k.phase = 'look'
    const c = k.circuit, i = Math.floor(c.count * fr) % c.count
    const p = c.samples[i], t = c.tangents[i], r = c.rights[i]
    const b = o.back ?? 9, h = o.h ?? 3.2, s = o.side ?? 0
    k.gfx.camera.position.set(p.x - t.x * b + r.x * s, p.y + h, p.z - t.z * b + r.z * s)
    const q = c.samples[(i + (o.ahead ?? 14)) % c.count]
    k.gfx.camera.lookAt(q.x, q.y + 1.5 + (o.up ?? 0), q.z)
    document.querySelectorAll('body > div').forEach((e) => { if (!e.querySelector('canvas')) (e as HTMLElement).style.visibility = 'hidden' })
    await new Promise((r) => setTimeout(r, 2200))
    return { load: Math.round(k.loadMs), len: Math.round(c.length) }
  }
  /**
   * Render a frame by hand (works with the window hidden) and save it as a
   * JPEG through the dev server; returns the file path.
   */
  w.__shot = async (id: string, fr: number, name: string, o: { back?: number; h?: number; side?: number; ahead?: number; up?: number; w?: number; path?: number; cam?: number[]; at?: number[] } = {}) => {
    await load(id)
    k.loop.stop()
    k.phase = 'look'
    const c = o.path ? k.circuit.branches[o.path - 1] : k.circuit, i = Math.floor(c.count * fr) % c.count
    const p = c.samples[i], t = c.tangents[i], r = c.rights[i], cam = k.gfx.camera
    if (o.cam) cam.position.set(o.cam[0], o.cam[1], o.cam[2])
    else cam.position.set(p.x - t.x * (o.back ?? 10) + r.x * (o.side ?? 0), p.y + (o.h ?? 3.4), p.z - t.z * (o.back ?? 10) + r.z * (o.side ?? 0))
    const q = c.samples[Math.min(c.count - 1, i + (o.ahead ?? 20))]
    if (o.at) cam.lookAt(o.at[0], o.at[1], o.at[2])
    else cam.lookAt(q.x, q.y + 1.5 + (o.up ?? 0), q.z)
    cam.fov = 62
    cam.updateProjectionMatrix()
    for (let n = 0; n < 12; n++) { k.update(1 / 60, 100 + n / 60); k.post.setSpeed(0); if (n > 8) k.post.render(1 / 60) }
    const src = k.gfx.renderer.domElement
    const cv = document.createElement('canvas')
    cv.width = o.w ?? 960
    cv.height = Math.round(cv.width * src.height / src.width)
    cv.getContext('2d')!.drawImage(src, 0, 0, cv.width, cv.height)
    const res = await fetch(`/__shot?name=${encodeURIComponent(name)}`, { method: 'POST', body: cv.toDataURL('image/jpeg', 0.8) })
    k.loop.start()
    return res.text()
  }
  /**
   * Anything you can see sitting on the road: looks straight down onto every
   * road from just above car height and lists what it hits, grouped by object.
   */
  w.__clutter = async (id: string) => {
    await load(id)
    const probe = { i: -1, lat: 0, y: 0 }
    const v = new THREE.Vector3(), m4 = new THREE.Matrix4(), box = new THREE.Box3()
    const groups = new Map<string, { name: string; type: string; color: string; n: number; at: number[][] }>()
    // a point sitting on a road, between just above the surface and car height
    const onRoad = (x: number, y: number, z: number): number[] | null => {
      for (let b = 0; b < k.circuit.all.length; b++) {
        const c = k.circuit.all[b]
        if (!c.roadAt(x, z, y + 0.2, probe) || probe.i < 0 || c.gap[probe.i]) continue
        if (Math.abs(probe.lat) > c.widths[probe.i] / 2 - 0.8) continue
        const h = y - probe.y
        if (h > 0.45 && h < 3) return [b, +(probe.i / c.count).toFixed(3), Math.round(x), +h.toFixed(1), Math.round(z)]
      }
      return null
    }
    const note = (o: any, at: number[]) => {
      const mat = Array.isArray(o.material) ? o.material[0] : o.material
      const g = groups.get(o.uuid) ?? { name: o.name || o.parent?.name || '', type: o.type, color: mat?.color ? '#' + mat.color.getHexString() : '', n: 0, at: [] as number[][] }
      g.n++
      if (g.at.length < 4) g.at.push(at)
      groups.set(o.uuid, g)
    }
    const targets: any[] = []
    k.root.traverse((o: any) => { if ((o.isMesh || o.isInstancedMesh) && o.visible) targets.push(o) })
    let work = 0
    for (const o of targets) {
      o.updateMatrixWorld(true)
      const pos = o.geometry?.attributes?.position
      if (!pos) continue
      if (o.isInstancedMesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        for (let q = 0; q < o.count; q++) {
          o.getMatrixAt(q, m4)
          box.copy(o.geometry.boundingBox).applyMatrix4(m4).applyMatrix4(o.matrixWorld)
          if (box.max.x - box.min.x > 80) continue
          v.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2)
          const at = onRoad(v.x, Math.max(box.min.y, v.y), v.z) ?? onRoad(v.x, (box.min.y + box.max.y) / 2, v.z)
          if (at) note(o, at)
        }
      } else {
        const step = Math.max(1, Math.floor(pos.count / 40000))
        for (let q = 0; q < pos.count; q += step) {
          v.fromBufferAttribute(pos, q).applyMatrix4(o.matrixWorld)
          const at = onRoad(v.x, v.y, v.z)
          if (at) note(o, at)
        }
      }
      if (++work % 20 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    return [...groups.values()].sort((a, b) => b.n - a.n)
  }
  /**
   * Things you'd drive straight through: visible objects standing on or just
   * beside a road, at car height, with nothing solid there to stop you.
   */
  w.__ghosts = async (id: string) => {
    await load(id)
    const wd = k.world, probe = { i: -1, lat: 0, y: 0 }, hit = { nx: 0, nz: 0, depth: 0 }
    const v = new THREE.Vector3(), m4 = new THREE.Matrix4(), box = new THREE.Box3()
    const groups = new Map<string, { name: string; color: string; n: number; at: number[][] }>()
    // a point beside or on a road, at car height above it: which road, how far out, how high
    const near = (x: number, y: number, z: number): number[] | null => {
      for (let b = 0; b < k.circuit.all.length; b++) {
        const c = k.circuit.all[b]
        const list = c.near(x, z)
        if (!list) continue
        let i = -1, bd = 1e9
        for (const j of list) { const q = c.samples[j]; const dd = (q.x - x) ** 2 + (q.z - z) ** 2 + ((q.y - y) * 3) ** 2; if (dd < bd) { bd = dd; i = j } }
        if (i < 0) continue
        const s = c.samples[i], r = c.rights[i], t = c.tangents[i]
        if (c.gap[i]) continue
        const lat = Math.abs((x - s.x) * r.x + (z - s.z) * r.z), along = Math.abs((x - s.x) * t.x + (z - s.z) * t.z)
        const out = lat - c.widths[i] / 2, h = y - s.y
        if (along > 3 || out > 2.5 || h < 0.5 || h > 2.6) continue
        // edges with a rail are guarded anyway
        if (out > -0.6 && ((x - s.x) * r.x + (z - s.z) * r.z > 0 ? c.railR[i] : c.railL[i])) continue
        return [b, +(i / c.count).toFixed(3), Math.round(x), +h.toFixed(1), Math.round(z), +out.toFixed(1)]
      }
      return null
    }
    const solidAt = (x: number, y: number, z: number) => wd.collide(x, z, y, 0.6, hit) || wd.blocked(x, z, 0.6)
    const note = (o: any, at: number[]) => {
      const mat = Array.isArray(o.material) ? o.material[0] : o.material
      const g = groups.get(o.uuid) ?? { name: o.name || o.parent?.name || '', color: mat?.color ? '#' + mat.color.getHexString() : '', n: 0, at: [] as number[][] }
      g.n++
      if (g.at.length < 4) g.at.push(at)
      groups.set(o.uuid, g)
    }
    const targets: any[] = []
    k.root.traverse((o: any) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.visible) return
      const mat = Array.isArray(o.material) ? o.material[0] : o.material
      // see-through glow, water and road decals are not things you hit
      if (mat?.transparent || mat?.blending === THREE.AdditiveBlending || o.renderOrder > 0) return
      targets.push(o)
    })
    let work = 0
    for (const o of targets) {
      o.updateMatrixWorld(true)
      const pos = o.geometry?.attributes?.position
      if (!pos) continue
      if (o.isInstancedMesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
        for (let q = 0; q < o.count; q++) {
          o.getMatrixAt(q, m4)
          box.copy(o.geometry.boundingBox).applyMatrix4(m4).applyMatrix4(o.matrixWorld)
          if (box.max.x - box.min.x > 60 || box.max.y - box.min.y < 0.8) continue
          v.set((box.min.x + box.max.x) / 2, box.min.y + 1.2, (box.min.z + box.max.z) / 2)
          const at = near(v.x, v.y, v.z)
          if (at && !solidAt(v.x, v.y, v.z)) note(o, at)
        }
      } else {
        const step = Math.max(1, Math.floor(pos.count / 30000))
        for (let q = 0; q < pos.count; q += step) {
          v.fromBufferAttribute(pos, q).applyMatrix4(o.matrixWorld)
          const at = near(v.x, v.y, v.z)
          if (at && !solidAt(v.x, v.y, v.z)) note(o, at)
        }
      }
      if (++work % 3 === 0) await new Promise((r) => setTimeout(r, 0))
    }
    void probe
    return [...groups.values()].sort((a, b) => b.n - a.n)
  }
  /**
   * A race played with items in use, rendering every few frames, watching
   * the picture for black or near-black frames and noting what was going on.
   */
  w.__dark = async (id: string, secs = 60) => {
    await load(id)
    k.noIntro = true
    k.loop.stop()
    await k.startRace(3, 'medium')
    const Rival = k.rivals[0].constructor
    const ap = new Rival(k.player, { name: 'AP', pace: 1, mistakes: 0, bold: 0.4, color: 0, car: 'rotor' }, 'hard', Math.random)
    const dt = 1 / 60
    k.driver = () => { ap.drive(dt, 0); return { ...ap.input, item: !!k.player.item && Math.random() < 0.04 } }
    const cv = document.createElement('canvas')
    cv.width = 32; cv.height = 18
    const g = cv.getContext('2d', { willReadFrequently: true })!
    const src = k.gfx.renderer.domElement
    let T = 0, n = 0, chunk = performance.now()
    const dark: any[] = [], log: number[] = []
    while (T < secs) {
      k.update(dt, T); T += dt
      if (++n % 10 !== 0) continue
      k.post.render(dt)
      g.drawImage(src, 0, 0, 32, 18)
      const d = g.getImageData(0, 0, 32, 18).data
      let sum = 0, black = 0
      for (let i = 0; i < d.length; i += 4) { const l = d[i]! + d[i + 1]! + d[i + 2]!; sum += l; if (l < 12) black++ }
      const avg = sum / (d.length / 4) / 3
      log.push(Math.round(avg))
      if (avg < 16 || black > 280) {
        const p = k.car.position, c = k.gfx.camera.position
        let nanMat = ''
        k.root.traverse((o: any) => { const m = o.material; if (!nanMat && m?.color && !Number.isFinite(m.color.r + m.color.g + m.color.b)) nanMat = o.type + ':' + (o.name || '') })
        dark.push([+T.toFixed(1), Math.round(avg), black, [Math.round(p.x), Math.round(p.y), Math.round(p.z)], [Math.round(c.x), Math.round(c.y), Math.round(c.z)], k.player.item, k.player.air, Number.isFinite(c.x + c.y + c.z), nanMat, k.gfx.renderer.getPixelRatio()])
      }
      if (performance.now() - chunk > 300) { await new Promise((r) => setTimeout(r, 0)); chunk = performance.now() }
    }
    k.driver = null
    k.exitRace()
    k.loop.start()
    return { frames: log.length, dark: dark.slice(0, 25), darkN: dark.length, low: Math.min(...log), mean: Math.round(log.reduce((a, b) => a + b, 0) / log.length) }
  }
  /** Anything solid on the road? */
  w.__clear = async (id: string) => {
    await load(id)
    const wd = k.world, out = { nx: 0, nz: 0, depth: 0 }, smp: number[][] = []
    let n = 0
    k.circuit.all.forEach((c: any, b: number) => {
      for (let i = 0; i < c.count; i += 2) {
        if (c.gap[i]) continue
        const p = c.samples[i], r = c.rights[i], half = c.widths[i] / 2 - 0.6
        for (const lat of [-half, -half / 2, 0, half / 2, half]) {
          if (wd.collide(p.x + r.x * lat, p.z + r.z * lat, p.y + 0.6, 0.2, out)) { n++; if (smp.length < 8) smp.push([b, +(i / c.count).toFixed(3), +lat.toFixed(1)]) }
        }
      }
    })
    return { id, n, smp, load: Math.round(k.loadMs), len: Math.round(k.circuit.length), branches: k.circuit.branches.map((b: any) => Math.round(b.length)) }
  }
  /**
   * One jump: start at a control point, at a lane and speed, flat out in a
   * straight line, and report the take-off, the landing and any rescue.
   */
  w.__fly = async (id: string, pt: number, o: { lat?: number; speed?: number; max?: number; nitro?: boolean; frames?: number } = {}) => {
    await load(id)
    const c = k.circuit, P = k.def.points, R = k.player, car = k.car
    let i0 = 0, bd = 1e12
    for (let i = 0; i < c.count; i++) { const s = c.samples[i], d = (s.x - P[pt][0]) ** 2 + (s.z - P[pt][2]) ** 2; if (d < bd) { bd = d; i0 = i } }
    const s = c.samples[i0], r = c.rights[i0], t = c.tangents[i0], lat = o.lat ?? 0
    const before = car.config?.maxSpeed
    if (o.max) car.setStats({ maxSpeed: o.max })
    k.loop.stop()
    R.place(new (car.position.constructor)(s.x + r.x * lat, s.y + 0.5, s.z + r.z * lat), Math.atan2(-t.x, -t.z), i0)
    car.setSpeed(o.speed ?? 60); car.nitro = o.nitro ? 1 : 0
    let take: any = null, land: any = null, rescued = false
    for (let f = 0; f < (o.frames ?? 420); f++) {
      const wasAir = R.air
      R.step(1 / 60, { accelerate: true, brake: false, left: false, right: false, nitro: !!o.nitro }, true)
      const q = car.position
      if (!wasAir && R.air && !take && R.airTime === 0) take = { x: Math.round(q.x), z: Math.round(q.z), y: +q.y.toFixed(1), vy: +R.vy.toFixed(1), v: Math.round(car.getSpeed()) }
      if (wasAir && !R.air && take && !land) land = { x: Math.round(q.x), z: Math.round(q.z), y: +q.y.toFixed(1), onRoad: R.onRoad }
      if (R.rescue > 0) { rescued = true; break }
    }
    if (o.max && before) car.setStats({ maxSpeed: before })
    k.loop.start()
    return { lat, speed: o.speed, max: o.max, nitro: !!o.nitro, take, land, rescued }
  }
  /**
   * Every gap on a track: its length and drop, and whether a rival's brain
   * clears it from a run-up, with the slowest car and the fastest.
   */
  w.__gaps = async (id: string) => {
    await load(id)
    const out: any[] = []
    const { Rival } = await import('./Rival')
    k.loop.stop()
    for (const c of k.circuit.all) {
      for (let i = 1; i < c.count; i++) {
        if (!c.gap[i] || c.gap[i - 1]) continue
        let j = i
        while (j < c.count - 1 && c.gap[j]) j++
        const lip = c.samples[i - 1], land = c.samples[j]
        const row: any = { path: c === k.circuit ? 'main' : c.join.name, at: +(i / c.count).toFixed(3), len: Math.round(Math.hypot(land.x - lip.x, land.z - lip.z)), drop: +(lip.y - land.y).toFixed(1), slope: +c.tangents[i - 1].y.toFixed(3), runs: [] }
        // slowest car, fastest car, then an ordinary car with every boost strip switched off
        for (const [max, nopad] of [[62.5, false], [69, false], [64, true]] as const) {
          const saved = k.circuit.all.map((p: any) => p.pad.slice())
          if (nopad) for (const p of k.circuit.all) p.pad.fill(false)
          const R = k.player, car = k.car
          car.setStats({ maxSpeed: max })
          const i0 = c.closed ? (i - 90 + c.count) % c.count : Math.max(0, i - 90)
          const s = c.samples[i0], t = c.tangents[i0]
          R.place(new (car.position.constructor)(s.x, s.y + 0.5, s.z), Math.atan2(-t.x, -t.z), k.circuit.track(s.x, s.z, 0, k.circuit.count))
          R.path = c; R.pi = i0
          car.setSpeed(max * 0.9)
          car.nitro = 0
          const ap = new Rival(R, { name: 'AP', pace: 1, mistakes: 0, bold: 0.5, color: 0, car: 'x' }, 'hard', Math.random)
          let ok = true, passed = false
          for (let f = 0; f < 600 && !passed; f++) {
            ap.drive(1 / 60, 0)
            R.step(1 / 60, ap.input, true)
            if (R.rescue > 0) { ok = false; break }
            // past the landing and back on the road (not down in the gap, driving on the ground)
            if (R.path === c && R.pi > j + 15 && !R.air && R.onRoad) passed = true
            if (R.path !== c && !R.air && R.onRoad) passed = true
          }
          row.runs.push((nopad ? 'nopad:' : '') + (ok && passed ? 'ok' : ok ? '?' : 'FALL'))
          k.circuit.all.forEach((p: any, n: number) => { p.pad = saved[n] })
        }
        k.car.setStats({ maxSpeed: 64 })
        out.push(row)
        i = j
      }
    }
    k.loop.start()
    return out
  }
  /** A whole race at top speed, the player driven by a rival's brain. */
  /** A contact sheet: views from the driver's seat at `n` points round a track, saved as one JPEG. */
  w.__sheet = async (id: string, n = 12, name?: string, from = 0, to = 1) => {
    await w.__look(id, 0)
    k.loop.stop()
    const c = k.circuit, W = 400, H = 260, cols = 4, rows = Math.ceil(n / cols)
    const sh = document.createElement('canvas')
    sh.width = W * cols; sh.height = H * rows
    const g = sh.getContext('2d')!
    for (let q = 0; q < n; q++) {
      const fr = from + ((q + 0.5) / n) * (to - from), i = Math.floor(c.count * fr) % c.count
      const p = c.samples[i], t = c.tangents[i], cam = k.gfx.camera
      cam.position.set(p.x - t.x * 6, p.y + 2.3, p.z - t.z * 6)
      const a = c.samples[(i + 12) % c.count]
      cam.lookAt(a.x, a.y + 1.2, a.z)
      for (let f = 0; f < 2; f++) k.post.render(1 / 60)
      g.drawImage(k.post.renderer.domElement, (q % cols) * W, Math.floor(q / cols) * H, W, H)
      g.fillStyle = '#ff0'; g.font = 'bold 22px sans-serif'
      g.fillText(fr.toFixed(3), (q % cols) * W + 8, Math.floor(q / cols) * H + 26)
    }
    k.loop.start()
    await fetch(`/__shot?name=${encodeURIComponent(name ?? 'sheet_' + id)}`, { method: 'POST', body: sh.toDataURL('image/jpeg', 0.75) })
    return 'ok'
  }
  w.__race = async (id: string, opts: { laps?: number; diff?: string; apLevel?: number } = {}) => {
    await load(id)
    k.noIntro = true
    k.loop.stop()
    await k.startRace(opts.laps ?? 3, opts.diff ?? 'medium')
    const Rival = k.rivals[0].constructor
    const ap = new Rival(k.player, { name: 'AP', pace: 1, mistakes: 0, bold: 0.4, color: 0, car: 'rotor' }, 'hard', Math.random)
    // a fixed skill for the stand-in player, so tuning the rivals' levels doesn't move it
    ap.level = opts.apLevel ?? 1
    const dt = 1 / 60
    k.driver = () => { ap.drive(dt, 0); return { ...ap.input } }
    let T = 0, lastLap = 0, chunkAt = performance.now()
    const fallAt: any[] = []
    const ev = k.events, rescued = ev.rescued
    ev.rescued = (r: any) => { if (fallAt.length < 12) fallAt.push([r.name.slice(0, 4), +(r.s / k.circuit.count).toFixed(3), Math.round(r.car.getSpeed()), r.path === k.circuit ? 'm' : r.path.join.name.slice(0, 4)]); rescued(r) }
    const res: any = { id, laps: [], nan: 0, finished: false, errors: [], maxAir: 0, paths: {} as Record<string, number> }
    const onErr = (e: ErrorEvent) => res.errors.push(String(e.message || e))
    window.addEventListener('error', onErr)
    try {
      while (T < 240) {
        k.update(dt, T); T += dt
        const p = k.player, c = k.car
        if (!Number.isFinite(c.position.x + c.position.y + c.position.z)) { res.nan++; break }
        res.maxAir = Math.max(res.maxAir, p.airTime)
        const pn = p.path === k.circuit ? 'main' : p.path.join.name
        res.paths[pn] = (res.paths[pn] ?? 0) + dt
        for (const r of k.racers) if (r.path !== k.circuit) { const key = 'rv:' + r.path.join.name; res.paths[key] = (res.paths[key] ?? 0) + dt }
        if (p.lap > lastLap) { lastLap = p.lap; res.laps.push(Math.round(p.lastLapMs) / 1000) }
        if (k.phase === 'finished' || k.phase === 'idle') { res.finished = p.finished; break }
        if (performance.now() - chunkAt > 400) { await yieldNow(); chunkAt = performance.now() }
      }
    } catch (e) { res.errors.push(String((e as Error).stack || e).slice(0, 300)) }
    window.removeEventListener('error', onErr)
    ev.rescued = rescued
    res.fallAt = fallAt
    res.maxAir = +res.maxAir.toFixed(2)
    res.crashes = k.player.crashes; res.falls = k.player.falls; res.hits = k.player.hits; res.tricks = k.player.tricks
    res.rivalHits = k.racers.filter((r: any) => !r.isPlayer).map((r: any) => r.hits)
    for (const key of Object.keys(res.paths)) res.paths[key] = +res.paths[key].toFixed(1)
    res.rivalFalls = k.racers.filter((r: any) => !r.isPlayer).map((r: any) => r.falls)
    res.rivalProg = k.racers.filter((r: any) => !r.isPlayer).map((r: any) => +(r.progress / k.circuit.count).toFixed(2))
    res.place = k.order ? k.order().indexOf(k.player) + 1 : null
    // seconds between you and each rival at the flag (+ = rival behind you), from their pace
    res.gaps = k.racers.filter((r: any) => !r.isPlayer).map((r: any) => {
      const tot = (opts.laps ?? 3) * k.circuit.count
      const t = r.finished ? r.finishMs : k.raceMs * tot / Math.max(r.progress, tot * 0.05)
      return +((t - k.player.finishMs) / 1000).toFixed(1)
    })
    res.len = Math.round(k.circuit.length)
    k.driver = null; k.exitRace(); k.loop.start()
    return res
  }
}
