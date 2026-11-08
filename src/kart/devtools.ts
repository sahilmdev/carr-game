/* Dev-only helpers for checking tracks from the console. Never shipped. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function install(app: unknown): void {
  const k = app as any
  const w = window as any
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
  w.__race = async (id: string, opts: { laps?: number; diff?: string } = {}) => {
    await load(id)
    k.noIntro = true
    k.loop.stop()
    await k.startRace(opts.laps ?? 3, opts.diff ?? 'medium')
    const Rival = k.rivals[0].constructor
    const ap = new Rival(k.player, { name: 'AP', pace: 1, mistakes: 0, bold: 0.4, color: 0, car: 'rotor' }, 'hard', Math.random)
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
        if (performance.now() - chunkAt > 400) { await new Promise((r) => setTimeout(r, 0)); chunkAt = performance.now() }
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
    res.len = Math.round(k.circuit.length)
    k.driver = null; k.exitRace(); k.loop.start()
    return res
  }
}
