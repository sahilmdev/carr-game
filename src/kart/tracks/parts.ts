import * as THREE from 'three'
import { canvasTexture, trs, softDot } from '../../game/biomes/kit'
import { grandstand, Mesher, place, surface } from '../art/arch'
import type { BuildKit } from '../types'
import type { Dresser } from '../dress'

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

/** The main grandstand along the start straight. */
export function stands(k: BuildKit, from: number, to: number, side: number, shirts: number[], accent = 0xff8a3c, brand = 'Nitro Cosmos'): void {
  grandstand(k, from, to, side, shirts, accent, brand)
}

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
  for (const s of spots) {
    const sc = size[0] + k.d.rand() * (size[1] - size[0])
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, rotation: k.d.rand() * 6.28 }))
    m.position.copy(s)
    m.scale.set(sc, sc * 0.55, 1)
    k.root.add(m)
  }
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
