(() => {
  const g = __hd
  g.loop.stop(); document.getElementById('splash').style.display = 'none'; g.startRace(); g.phase = 'racing'
  window.__dodge = true; window.__T = 500
  const inp = g.getInput()
  inp.get = () => {
    const c = g.car, tr = g.track, n = tr.sampleCount, i = g.trackIndexHint, k = (i + Math.round(10 + c.getSpeed() * .45)) % n, p = tr.samples[k]
    let lat = 0; const v = g.scenery.biomes.volcano
    if (__dodge && v.chase.running) for (const b of v.breaches) if (v.chase.carK > b.k0 - 70 && v.chase.carK < b.k1 + 5) lat = -b.side * 6.5
    const tg = tr.tangents[k], dx = p.x + (-tg.z) * lat - c.position.x, dz = p.z + tg.x * lat - c.position.z
    let d = Math.atan2(-dx, -dz) - c.heading
    while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832
    return { accelerate: true, brake: false, left: d > .03, right: d < -.03, nitro: false }
  }
  window.__tp = (i, s = 60) => { const t = g.track, p = t.samples[i], q = t.tangents[i]; g.flight = null; g.loopRide = null; g.trackIndexHint = i; g.car.setPose(p, Math.atan2(-q.x, -q.z)); g.car.setSpeed(s) }
  window.__adv = (s) => { let T = window.__T; for (let k = 0; k < s * 60; k++) { T += 1 / 60; g.update(1 / 60, T) } window.__T = T; g.post.render(1 / 60); return [g.trackIndexHint, g.track.zoneOfSample(g.trackIndexHint), Math.round(g.car.getSpeed()), g.phase] }
  window.__w = []; const ow = g.wreck.bind(g); g.wreck = t => { __w.push(g.track.zoneOfSample(g.trackIndexHint)); ow(t) }
  // view from a road sample, looking along or across
  window.__look = (i, lat, up, ahead, fov = 60) => { const t = g.track, p = t.samples[i], q = t.tangents[i], c = g.gfx.camera; __tp(i, 0); __adv(0.05); c.position.set(p.x - q.z * lat, p.y + up, p.z + q.x * lat); c.lookAt(p.x + q.x * ahead, p.y + up, p.z + q.z * ahead); c.fov = fov; c.updateProjectionMatrix(); g.post.render(1 / 60) }
})()
