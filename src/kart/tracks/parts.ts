import * as THREE from 'three'
import { canvasTexture, trs, softDot } from '../../game/biomes/kit'
import { grandstand, Mesher, place, surface } from '../art/arch'
import type { BuildKit } from '../types'
import type { Dresser } from '../dress'
import type { Circuit } from '../Circuit'
import type { Platform, Zone } from '../World'

export const glow = (r: number, g: number, b: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false })

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`

/** Start gantry over the line: a steel truss on solid legs, with a light board. */
export function gantry(k: BuildKit, text: string, color: string): void {
  const { circuit: c, world: w, root } = k
  const p = c.samples[0]!, r = c.rights[0]!, t = c.tangents[0]!, half = c.widths[0]! / 2 + 1.5
  const yaw = Math.atan2(-t.x, -t.z)
  const m = new Mesher(), H = 11, dark = 0x23262e
  // built along local x, then turned to the road
  for (const s of [-1, 1]) {
    for (const f of [-1, 1]) m.box(0.34, H + 2, 0.34, s * half + f * 0.6, H / 2, 0, dark)
    for (let y = 1; y < H; y += 2) m.bar(new THREE.Vector3(s * half - 0.6, y, 0), new THREE.Vector3(s * half + 0.6, y + 2, 0), 0.05, dark, 4)
  }
  for (const y of [H - 1.6, H + 1.6]) for (const z of [-0.7, 0.7]) m.box(half * 2 + 2, 0.2, 0.2, 0, y, z, dark)
  for (let x = -half; x < half; x += 1.6) {
    m.bar(new THREE.Vector3(x, H - 1.6, 0.7), new THREE.Vector3(x + 1.6, H + 1.6, 0.7), 0.06, dark, 4)
    m.bar(new THREE.Vector3(x, H - 1.6, -0.7), new THREE.Vector3(x + 1.6, H + 1.6, -0.7), 0.06, dark, 4)
  }
  const frame = place(k, m, surface('metal'))
  frame.position.copy(p)
  frame.rotation.y = yaw
  for (const s of [-1, 1]) w.addPost(p.x + r.x * s * half, p.z + r.z * s * half, 1)
  const tex = canvasTexture(1024, 128, (g, W, H2) => {
    g.fillStyle = '#080a10'
    g.fillRect(0, 0, W, H2)
    g.fillStyle = color
    g.fillRect(0, 0, W, 7)
    g.fillRect(0, H2 - 7, W, 7)
    g.fillStyle = '#fff'
    g.font = 'italic 800 84px "Barlow Condensed", Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text.toUpperCase(), W / 2, H2 / 2 + 2)
  })
  const face = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: new THREE.Color(1.2, 1.2, 1.2) })
  for (const z of [-0.85, 0.85]) {
    const board = new THREE.Mesh(new THREE.PlaneGeometry(half * 1.7, half * 1.7 / 8), face)
    board.position.set(p.x + t.x * z, p.y + H, p.z + t.z * z)
    board.rotation.y = yaw + (z > 0 ? Math.PI : 0)
    root.add(board)
  }
}

/** The main grandstand along the start straight: retired (no stadium or crowds on any track). */
export function stands(_k: BuildKit, _from: number, _to: number, _side: number, _shirts: number[], _accent = 0xff8a3c, _brand = 'Nitro Cosmos'): void {
  // kept so track files still call it; set SHOW_STANDS to bring it back
  if (SHOW_STANDS) grandstand(_k, _from, _to, _side, _shirts, _accent, _brand)
}
const SHOW_STANDS = false

/** Chevron boards on the outside of sharp bends. */
export function arrows(k: BuildKit, tint: number): void {
  const { circuit: c, world: w, d } = k
  const n = c.count
  const tex = canvasTexture(256, 128, (g, W, H) => {
    g.fillStyle = '#0b0d14'
    g.fillRect(0, 0, W, H)
    g.fillStyle = css(tint)
    for (let q = 0; q < 3; q++) {
      const x = 20 + q * 76
      g.beginPath()
      g.moveTo(x, 16); g.lineTo(x + 34, 16); g.lineTo(x + 74, H / 2); g.lineTo(x + 34, H - 16); g.lineTo(x, H - 16); g.lineTo(x + 40, H / 2)
      g.closePath()
      g.fill()
    }
  })
  const boards: THREE.Matrix4[] = [], flipped: THREE.Matrix4[] = []
  const poles = new Mesher()
  let last = -999
  for (let i = 0; i < n; i += 4) {
    const a = c.tangents[i]!, b = c.tangents[(i + 18) % n]!
    const cross = a.x * b.z - a.z * b.x
    if (Math.abs(cross) < 0.28 || i - last < 34 || c.gap[i]) continue
    const j = (i + 8) % n, p = c.samples[j]!, r = c.rights[j]!, t = c.tangents[j]!
    const side = cross > 0 ? -1 : 1
    const off = side * (c.widths[i]! / 2 + 5)
    const x = p.x + r.x * off, z = p.z + r.z * off
    if (d.roadGap(x, z) < 3.5) continue
    last = i
    const y = c.raised[i] ? p.y + 0.5 : w.terrainAt(x, z)
    const yaw = Math.atan2(-t.x, -t.z);
    (cross > 0 ? boards : flipped).push(trs(x, y + 2.3, z, yaw, new THREE.Vector3(6, 2.4, 1)))
    for (const e of [-2, 2]) poles.box(0.14, 2.2, 0.14, x + t.z * e, y + 1.1, z - t.x * e, 0x3a3d46)
  }
  const col = new THREE.Color(1.25, 1.25, 1.25)
  const face = new THREE.MeshBasicMaterial({ map: tex, color: col, toneMapped: false, side: THREE.DoubleSide })
  const geo = new THREE.PlaneGeometry(1, 1)
  if (boards.length) d.instanced(geo, face, boards, false)
  if (flipped.length) {
    const tex2 = tex.clone()
    tex2.wrapS = THREE.RepeatWrapping
    tex2.repeat.x = -1
    tex2.offset.x = 1
    tex2.needsUpdate = true
    d.instanced(geo, new THREE.MeshBasicMaterial({ map: tex2, color: col, toneMapped: false, side: THREE.DoubleSide }), flipped, false)
  }
  if (!poles.empty) place(k, poles, surface('metal'), false)
}

let crateTex: THREE.CanvasTexture | null = null
/** Crates that smash when hit, and come back next race. */
export function crates(d: Dresser, spots: THREE.Vector3[], color: number): void {
  if (!spots.length) return
  crateTex ??= canvasTexture(128, 128, (g, W) => {
    g.fillStyle = '#c8b698'
    g.fillRect(0, 0, W, W)
    g.fillStyle = '#7d6a4e'
    for (let q = 0; q < 5; q++) g.fillRect(0, q * 26, W, 2)
    g.strokeStyle = '#6a583f'
    g.lineWidth = 12
    g.strokeRect(6, 6, W - 12, W - 12)
    g.lineWidth = 10
    g.beginPath(); g.moveTo(8, 8); g.lineTo(W - 8, W - 8); g.stroke()
  })
  const mats = spots.map((s) => trs(s.x, s.y + 0.6, s.z, d.rand() * 3, 1.2))
  const im = d.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, map: crateTex, roughness: 0.85 }), mats)
  im.frustumCulled = false
  const gone = new THREE.Matrix4().makeScale(0, 0, 0)
  spots.forEach((s, k) => d.world.addBreakable({
    x: s.x, z: s.z, y: s.y, r: 0.8, live: true,
    hit: () => { im.setMatrixAt(k, gone); im.instanceMatrix.needsUpdate = true },
  }))
}

/** Slow drifting specks round the camera: petals, ash, rain mist. */
export function drift(k: BuildKit, count: number, color: number, size: number, fall: number, streak = false): THREE.Points {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) seed.set([Math.random() * 90 - 45, Math.random() * 40, Math.random() * 90 - 45], i * 3)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const map = streak ? canvasTexture(16, 64, (c2, W, H) => {
    const gr = c2.createLinearGradient(0, 0, 0, H)
    gr.addColorStop(0, 'rgba(255,255,255,0)')
    gr.addColorStop(0.5, 'rgba(255,255,255,0.9)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    c2.fillStyle = gr
    c2.fillRect(W / 2 - 1, 0, 2, H)
  }) : softDot()
  const m = new THREE.Points(g, new THREE.PointsMaterial({ map, color, size, transparent: true, depthWrite: false, opacity: 0.9 }))
  m.frustumCulled = false
  k.root.add(m)
  k.onFrame((f) => {
    if (!m.visible) return
    const c = f.camera.position
    for (let i = 0; i < count; i++) {
      const o = i * 3
      const y = ((seed[o + 1]! - f.time * fall) % 40 + 40) % 40
      pos[o] = c.x + ((seed[o]! + Math.sin(f.time * 0.7 + i) * 3 + 45) % 90) - 45
      pos[o + 1] = c.y - 10 + y
      pos[o + 2] = c.z + seed[o + 2]! + Math.cos(f.time * 0.5 + i) * 3
    }
    g.getAttribute('position').needsUpdate = true
  })
  return m
}

/** Soft billboards of cloud or mist, far cheaper than they look. */
export function mist(k: BuildKit, spots: THREE.Vector3[], size: [number, number], color: number, opacity: number): void {
  const tex = cloudTexture()
  const all: { m: THREE.Sprite; mat: THREE.SpriteMaterial; r: number }[] = []
  for (const s of spots) {
    const sc = size[0] + k.d.rand() * (size[1] - size[0])
    const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, rotation: k.d.rand() * 6.28 })
    const m = new THREE.Sprite(mat)
    m.position.copy(s)
    m.scale.set(sc, sc * 0.55, 1)
    k.root.add(m)
    all.push({ m, mat, r: sc * 0.5 })
  }
  // a bank of mist right on the camera would cover the whole screen (slow to
  // draw, and you can't see through it anyway): fade it out as you get close
  k.onFrame((f) => {
    for (const a of all) {
      const d = a.m.position.distanceTo(f.camera.position)
      const u = THREE.MathUtils.smoothstep(d, a.r * 0.5, a.r * 1.3)
      a.m.visible = u > 0.02
      a.mat.opacity = opacity * u
    }
  })
}

let cloudTex: THREE.CanvasTexture | null = null
export function cloudTexture(): THREE.CanvasTexture {
  cloudTex ??= canvasTexture(256, 256, (g, W) => {
    g.clearRect(0, 0, W, W)
    for (let q = 0; q < 70; q++) {
      const a = Math.random() * 6.28, r = Math.random() ** 0.7 * W * 0.32
      const x = W / 2 + Math.cos(a) * r, y = W / 2 + Math.sin(a) * r * 0.62, s = 22 + Math.random() * 42
      const gr = g.createRadialGradient(x, y, 0, x, y, s)
      gr.addColorStop(0, 'rgba(255,255,255,0.28)')
      gr.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = gr
      g.fillRect(x - s, y - s, s * 2, s * 2)
    }
  })
  return cloudTex
}

/** A boat-sized glow reflected as a long streak on wet ground. */
export function glowStreak(k: BuildKit, x: number, y: number, z: number, yaw: number, color: THREE.Color, len: number, width: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, len), new THREE.MeshBasicMaterial({ map: softDot(), color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }))
  m.rotation.set(-Math.PI / 2, 0, yaw)
  m.position.set(x, y, z)
  k.root.add(m)
  return m
}

/** The run of gap samples on a road nearest to a point: first and last gap index. */
export function findGap(c: Circuit, x: number, z: number): { i0: number; i1: number } {
  let best = -1, bd = 1e12
  for (let i = 0; i < c.count; i++) {
    if (!c.gap[i]) continue
    const p = c.samples[i]!, d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < bd) { bd = d; best = i }
  }
  let i0 = best, i1 = best
  while (i0 > 0 && c.gap[i0 - 1]) i0--
  while (i1 < c.count - 1 && c.gap[i1 + 1]) i1++
  return { i0, i1 }
}

export interface Deck {
  pl: Platform
  mesh: THREE.Object3D
  /** Put the deck's centre here, facing `yaw`, its top from `y0` (back) to `y1` (front), moving at (vx, vz). */
  set(x: number, z: number, yaw: number, y0: number, y1: number, vx: number, vz: number): void
}

/** A moving deck you can drive on, with a body under it and yellow edges. */
export function movingDeck(k: BuildKit, width: number, length: number, body: number, edge = 0xe8b020, depth = 1.2): Deck {
  const pl: Platform = { x: 0, z: 0, hx: width / 2, hz: length / 2, cos: 1, sin: 0, y0: 0, y1: 0, vx: 0, vz: 0, live: true }
  k.world.platforms.push(pl)
  const m = new Mesher()
  m.box(width, depth, length, 0, -depth / 2, 0, body)
  for (const s of [-1, 1]) m.box(0.4, 0.25, length, s * (width / 2 - 0.2), 0.1, 0, edge)
  for (let z = -length / 2 + 3; z < length / 2 - 2; z += 6) for (const s of [-1, 1]) m.box(0.45, 0.04, 2.2, s * 0.8, 0.03, z, edge, s * 0.7)
  const mesh = new THREE.Mesh(m.build(), surface('paint', { rough: 0.5, metal: 0.3 }))
  mesh.castShadow = true
  mesh.frustumCulled = false
  const pivot = new THREE.Group()
  pivot.add(mesh)
  k.root.add(pivot)
  return {
    pl,
    mesh: pivot,
    set(x, z, yaw, y0, y1, vx, vz) {
      pl.x = x; pl.z = z
      pl.cos = Math.cos(yaw); pl.sin = Math.sin(yaw)
      pl.y0 = y0; pl.y1 = y1
      pl.vx = vx; pl.vz = vz
      pivot.position.set(x, (y0 + y1) / 2, z)
      pivot.rotation.set(0, yaw, 0)
      mesh.rotation.x = -Math.atan2(y1 - y0, length)
    },
  }
}

/**
 * Force zones laid along a stretch of road, one turned box every `step`
 * samples, covering the road and a little either side. Returns them with the
 * road's right and forward at each, so a track can set a sideways or along
 * push every frame.
 */
export function roadZones(k: BuildKit, c: Circuit, i0: number, i1: number, step = 12, air = false): { z: Zone; rx: number; rz: number; fx: number; fz: number }[] {
  const out: { z: Zone; rx: number; rz: number; fx: number; fz: number }[] = []
  for (let i = i0; i < i1; i += step) {
    const p = c.samples[i]!, t = c.tangents[i]!, r = c.rights[i]!
    const yaw = Math.atan2(t.x, t.z)
    const z: Zone = { x: p.x, z: p.z, r: 0, hx: c.widths[i]! / 2 + 3, hz: step * (c.length / c.count) * 0.55, cos: Math.cos(yaw), sin: Math.sin(yaw), y0: p.y - 3, y1: p.y + 14, air, on: false }
    k.world.zones.push(z)
    out.push({ z, rx: r.x, rz: r.z, fx: t.x, fz: t.z })
  }
  return out
}

/** Specks drifting with the zones' push, so a current or a gust can be seen. */
export function zoneFx(k: BuildKit, zones: Zone[], color: number, size = 0.5, per = 40): void {
  const n = zones.length * per
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) seed.set([Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1], i * 3)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const m = new THREE.Points(g, new THREE.PointsMaterial({ map: softDot(), color, size, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }))
  m.frustumCulled = false
  k.root.add(m)
  let t = 0
  k.onFrame((f) => {
    t += f.dt
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi]!, hx = z.hx ?? z.r, hz = z.hz ?? z.r
      // a round zone has no turn of its own
      const cs = z.cos ?? 1, sn = z.sin ?? 0
      const vx = z.vx ?? 0, vz = z.vz ?? 0, live = z.on && (vx || vz || z.swirl || z.rise)
      for (let q = 0; q < per; q++) {
        const i = (zi * per + q) * 3
        if (!live) { pos[i + 1] = -1e5; continue }
        // drift along the push, wrapping inside the box
        const lvx = vx * cs - vz * sn, lvz = vx * sn + vz * cs
        const lx = ((seed[i]! * hx + lvx * t + 1e5 * hx) % (2 * hx)) - hx
        const lz = ((seed[i + 2]! * hz + lvz * t + 1e5 * hz) % (2 * hz)) - hz
        pos[i] = z.x + lx * cs + lz * sn
        pos[i + 2] = z.z - lx * sn + lz * cs
        pos[i + 1] = z.rise ? z.y0 + ((seed[i + 1]! + t * 0.25) % 1) * (z.y1 - z.y0) : z.y0 + 3.4 + seed[i + 1]! * 5
      }
    }
    g.attributes['position']!.needsUpdate = true
  })
}

/** Steel rails and sleepers along every locked (on-rails) stretch of a road. */
export function railTrack(k: BuildKit, c: Circuit, color = 0xb8bcc4): void {
  const m = new Mesher()
  for (let i = 0; i < c.count - 1; i += 1) {
    if (!c.lock[i] || !c.lock[i + 1]) continue
    const p = c.samples[i]!, q = c.samples[i + 1]!, r = c.rights[i]!
    for (const s of [-1.6, 1.6]) {
      const a = new THREE.Vector3(p.x + r.x * s, p.y + 0.22, p.z + r.z * s), b = new THREE.Vector3(q.x + r.x * s, q.y + 0.22, q.z + r.z * s)
      m.bar(a, b, 0.14, color, 5)
    }
    if (i % 2 === 0) m.box(4.6, 0.16, 0.5, p.x, p.y + 0.08, p.z, 0x3a2a1e, Math.atan2(-c.tangents[i]!.x, -c.tangents[i]!.z))
  }
  if (!m.empty) place(k, m, surface('metal', { metal: 0.85, rough: 0.3 }), false)
}

/** The track round each vertical loop on the main road: a hoop of road with rails. */
export function loopTracks(k: BuildKit, color = 0xd8dce4, edge = 0xe8b020): void {
  const c = k.circuit
  for (const L of c.loops) {
    const s = c.samples[L.i]!, t = c.tangents[L.i]!, r = c.rights[L.i]!
    const fx = t.x / Math.hypot(t.x, t.z), fz = t.z / Math.hypot(t.x, t.z)
    const m = new Mesher(), N = 64, w = Math.min(8, c.widths[L.i]! - 2)
    const at = (u: number, lat: number) => {
      const th = u * Math.PI * 2, side = -L.side / 2 + L.side * u
      return new THREE.Vector3(s.x + fx * L.r * Math.sin(th) + r.x * (side + lat), s.y + L.r * (1 - Math.cos(th)) - 0.15, s.z + fz * L.r * Math.sin(th) + r.z * (side + lat))
    }
    for (let q = 3; q < N - 3; q++) {
      const u0 = q / N, u1 = (q + 1) / N
      // the deck, as a strip of boxes laid round the hoop, outside the car's path
      const a = at(u0, 0), b = at(u1, 0), mid = a.clone().lerp(b, 0.5)
      const th = (u0 + u1) * Math.PI
      const g = new THREE.BoxGeometry(w, 0.5, a.distanceTo(b) + 0.2)
      const rot = new THREE.Matrix4().makeRotationY(Math.atan2(fx, fz)).multiply(new THREE.Matrix4().makeRotationX(-th))
      const out = new THREE.Vector3(0, -0.3, 0).applyMatrix4(rot)
      m.add(g, new THREE.Matrix4().compose(mid.clone().add(out), new THREE.Quaternion().setFromRotationMatrix(rot), new THREE.Vector3(1, 1, 1)), color)
      for (const sd of [-1, 1]) m.bar(at(u0, sd * w / 2), at(u1, sd * w / 2), 0.2, edge, 5)
    }
    // the supports
    for (const sd of [-1, 1]) m.bar(new THREE.Vector3(s.x + fx * L.r + r.x * sd * (w / 2 + 1), k.world.terrainAt(s.x, s.z) - 2, s.z + fz * L.r + r.z * sd * (w / 2 + 1)), at(0.5, sd * (w / 2 + 1)), 0.5, 0x6a7078, 8)
    // the hoop stands over the road on purpose: the road clean-up leaves it be
    place(k, m, surface('paint', { rough: 0.35, metal: 0.4 }), false).userData['keep'] = true
  }
}

/**
 * A wall panel you can ride: a tall glowing billboard along one edge of a
 * road from sample `i0` to `i1`, registered in the world so a car running
 * along that edge at speed goes up onto it (see Racer.catchWall). Rails go
 * on that edge so you lean on the panel rather than fall past it.
 */
export function wallPanel(k: BuildKit, c: Circuit, i0: number, i1: number, side: number, h: number, text: string, color: number): void {
  k.world.wallRides.push({ c, i0, i1, side, h })
  for (let i = i0 - 4; i <= i1 + 4; i++) { if (side > 0) c.railR[i] = true; else c.railL[i] = true }
  const col = new THREE.Color(color)
  const tex = canvasTexture(1024, 128, (g, w, hh) => {
    g.fillStyle = '#05060c'
    g.fillRect(0, 0, w, hh)
    g.strokeStyle = '#' + col.getHexString()
    g.lineWidth = 8
    g.strokeRect(6, 6, w - 12, hh - 12)
    g.fillStyle = '#' + col.getHexString()
    g.font = 'bold 84px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    for (let q = 0; q < 3; q++) g.fillText(text, (w / 3) * (q + 0.5), hh / 2 + 4)
    // chevrons along the bottom: the way to ride it
    for (let x = 30; x < w; x += 60) { g.beginPath(); g.moveTo(x, hh - 22); g.lineTo(x + 18, hh - 14); g.lineTo(x, hh - 6); g.stroke() }
  })
  const H = h + 5
  const frame = new Mesher()
  const face = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6), toneMapped: false, side: THREE.DoubleSide })
  for (let i = i0; i < i1; i += 4) {
    const j = Math.min(i1, i + 4), a = c.samples[i]!, b = c.samples[j]!, r = c.rights[i]!, t = c.tangents[i]!
    const off = c.widths[i]! / 2 + 0.7
    const mx = (a.x + b.x) / 2 + r.x * side * off, mz = (a.z + b.z) / 2 + r.z * side * off, my = (a.y + b.y) / 2
    const len = Math.hypot(b.x - a.x, b.z - a.z) + 0.1, yaw = Math.atan2(-t.x, -t.z)
    const u0 = (i - i0) / (i1 - i0), u1 = (j - i0) / (i1 - i0)
    const g = new THREE.PlaneGeometry(len, H)
    const uv = g.attributes['uv']!
    for (let q = 0; q < uv.count; q++) uv.setX(q, uv.getX(q) < 0.5 ? (side > 0 ? 1 - u0 : u0) : (side > 0 ? 1 - u1 : u1))
    const m = new THREE.Mesh(g, face)
    m.position.set(mx, my + H / 2 - 0.3, mz)
    m.rotation.y = yaw + Math.PI / 2
    k.root.add(m)
    frame.box(0.6, H + 0.6, len, mx + r.x * side * 0.4, my + H / 2 - 0.3, mz + r.z * side * 0.4, 0x1a1c24, yaw)
    if ((i - i0) % 12 === 0) frame.post(0.25, 0.3, H + 2, mx + r.x * side * 1.2, my - 6, mz + r.z * side * 1.2, 0x2a2c34, 6)
  }
  place(k, frame, surface('metal', { metal: 0.6, rough: 0.4 }))
}

/**
 * Lights that trace the road at night: a glowing strip along each edge of
 * every road, unbroken all the way round, and a small lamp on a post every
 * `spacing` metres just outside it with a pool of light on the tarmac.
 * You can always see where the road goes, even in the dark.
 */
export function edgeLights(k: BuildKit, color: THREE.Color, o: { spacing?: number; strip?: number; pool?: number } = {}): void {
  const spacing = Math.max(2, Math.round((o.spacing ?? 14) / 2)) // samples are ~2 m apart
  const stripW = o.strip ?? 0.32
  const pos: number[] = [], idx: number[] = []
  const lamps: THREE.Matrix4[] = [], posts: THREE.Matrix4[] = []
  const v = new THREE.Vector3(), q = new THREE.Vector3()
  for (const c of k.circuit.all) {
    const n = c.count, last = c.closed ? n : n - 1
    for (const sd of [-1, 1]) {
      const base = pos.length / 3
      for (let i = 0; i <= last; i++) {
        const j = i % n, half = c.widths[j]! / 2
        c.at(j, sd * (half - 0.35), 0.05, v)
        c.at(j, sd * (half - 0.35 - stripW), 0.05, q)
        pos.push(v.x, v.y, v.z, q.x, q.y, q.z)
        if (i < last && !c.gap[j] && !c.gap[(j + 1) % n]) {
          const a = base + i * 2
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
        }
      }
      for (let i = 0; i < n; i += spacing) {
        if (c.gap[i] || c.tunnel[i] || c.roll[i] || c.pipe[i]) continue
        const half = c.widths[i]! / 2
        c.at(i, sd * (half + 0.9), 0, v)
        if (k.world.blocked(v.x, v.z, 0.4)) continue
        posts.push(trs(v.x, v.y + 0.45, v.z, 0, new THREE.Vector3(0.12, 0.9, 0.12)))
        lamps.push(trs(v.x, v.y + 1.0, v.z, 0, 0.22))
      }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  const strip = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }))
  strip.userData['keep'] = true
  k.root.add(strip)
  if (lamps.length) {
    k.d.instanced(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshStandardMaterial({ color: 0x2a2c32, roughness: 0.6 }), posts, false)
    k.d.instanced(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(4), toneMapped: false }), lamps, false)
    // pools of light on the road under every other lamp
    const pool = o.pool ?? 0.22
    if (pool > 0) {
      const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: softDot(), color: color.clone().multiplyScalar(pool), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }), Math.ceil(lamps.length / 2))
      let n = 0
      for (let a = 0; a < lamps.length; a += 2) {
        const e = lamps[a]!.elements
        m.setMatrixAt(n++, trs(e[12]!, e[13]! - 0.93, e[14]!, 0, new THREE.Vector3(9, 1, 9)))
      }
      m.count = n
      m.userData['keep'] = true
      k.root.add(m)
    }
  }
}
