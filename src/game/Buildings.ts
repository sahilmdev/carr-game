import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Code-generated realistic buildings: textured facades with real window
 * rows (glass that reflects the sky, frames, sills), shop fronts with
 * awnings and sign bands, balconies, roof parapets and rooftop clutter.
 *
 * pool(kind) returns a template Group whose userData.variants holds many
 * different buildings; Scenery.placeModel() picks a random one per
 * placement. Materials are shared between variants so static batching
 * still merges them into few draw calls.
 */

export type BuildingKind = 'shop' | 'mid' | 'tower'

interface Palette { wall: string; trim: string; brick?: boolean }

const PLASTER: Palette[] = [
  { wall: '#d8cbb2', trim: '#efe8dc' },
  { wall: '#c7b39a', trim: '#e6dccb' },
  { wall: '#e2ddd2', trim: '#b9b2a6' },
  { wall: '#b9a58c', trim: '#ece4d4' },
  { wall: '#cfd3d4', trim: '#f2f2ef' },
  { wall: '#d6b9a0', trim: '#f3ebdf' },
  { wall: '#9d5a45', trim: '#dcd3c3', brick: true },
  { wall: '#8b4f3e', trim: '#d8cfc0', brick: true },
]
const AWNINGS = ['#2f5d4a', '#7a2a2a', '#26415f', '#c4a15a', '#3d3d3d', '#a04a2e']

const FLOOR_H = 3.2
const BAY_W = 3.4

let seed = 12345
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
const pickOf = <T>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]!

// ── Shared materials (cached so batching can merge across buildings) ──

const matCache = new Map<string, THREE.MeshStandardMaterial>()
function cachedMat(key: string, make: () => THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  let m = matCache.get(key)
  if (!m) { m = make(); matCache.set(key, m) }
  return m
}

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color: boolean): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (color) t.colorSpace = THREE.SRGBColorSpace
  return t
}

function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  for (let i = 0; i < 900; i++) {
    const v = Math.floor(rand() * 255)
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2)
  }
}

/**
 * One facade tile = one bay × one floor (128 × 128 px): wall, window frame,
 * glass and sill. Packed roughness (G) + metalness (B) map makes the glass
 * glossy and slightly mirror-like while the wall stays matte.
 */
function facadeMaterial(p: Palette, style: 'window' | 'curtain'): THREE.MeshStandardMaterial {
  return cachedMat(`facade|${p.wall}|${style}`, () => {
    const S = 128
    const win = style === 'curtain' ? { x0: 6, x1: 122, y0: 30, y1: 124 } : { x0: 30, x1: 98, y0: 22, y1: 100 }
    const map = canvasTex(S, S, (ctx) => {
      ctx.fillStyle = style === 'curtain' ? '#4a535b' : p.wall
      ctx.fillRect(0, 0, S, S)
      if (p.brick && style === 'window') {
        ctx.strokeStyle = 'rgba(60,40,30,0.35)'
        ctx.lineWidth = 1
        for (let y = 0; y < S; y += 8) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke()
          for (let x = (y / 8) % 2 ? 0 : 8; x < S; x += 16) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 8); ctx.stroke()
          }
        }
      }
      speckle(ctx, S, S, 0.05)
      // frame
      ctx.fillStyle = style === 'curtain' ? '#9aa3aa' : p.trim
      ctx.fillRect(win.x0 - 4, win.y0 - 4, win.x1 - win.x0 + 8, win.y1 - win.y0 + 8)
      // glass: dark with a soft lighter band (sky reflection baked in)
      const g = ctx.createLinearGradient(0, win.y0, 0, win.y1)
      g.addColorStop(0, '#5d6d7a')
      g.addColorStop(0.45, '#2b3742')
      g.addColorStop(1, '#1d262e')
      ctx.fillStyle = g
      ctx.fillRect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0)
      // mullion + transom
      ctx.fillStyle = style === 'curtain' ? '#9aa3aa' : p.trim
      ctx.fillRect((win.x0 + win.x1) / 2 - 2, win.y0, 4, win.y1 - win.y0)
      if (style === 'window') ctx.fillRect(win.x0, win.y0 + 22, win.x1 - win.x0, 3)
      // sill shadow + sill
      if (style === 'window') {
        ctx.fillStyle = 'rgba(0,0,0,0.25)'
        ctx.fillRect(win.x0 - 6, win.y1 + 8, win.x1 - win.x0 + 12, 4)
        ctx.fillStyle = p.trim
        ctx.fillRect(win.x0 - 6, win.y1 + 4, win.x1 - win.x0 + 12, 5)
      }
      // a few curtains / blinds behind the glass
      if (rand() < 0.5) {
        ctx.fillStyle = 'rgba(210,200,180,0.35)'
        ctx.fillRect(win.x0, win.y0, (win.x1 - win.x0) * 0.3, win.y1 - win.y0)
      }
      // rain streak grime under the sill
      const gr = ctx.createLinearGradient(0, win.y1, 0, S)
      gr.addColorStop(0, 'rgba(40,35,30,0.18)')
      gr.addColorStop(1, 'rgba(40,35,30,0)')
      ctx.fillStyle = gr
      ctx.fillRect(win.x0, win.y1 + 9, win.x1 - win.x0, S - win.y1)
    }, true)
    const rm = canvasTex(S, S, (ctx) => {
      ctx.fillStyle = 'rgb(0,235,0)' // wall: rough, not metal
      ctx.fillRect(0, 0, S, S)
      ctx.fillStyle = 'rgb(0,150,0)' // frame
      ctx.fillRect(win.x0 - 4, win.y0 - 4, win.x1 - win.x0 + 8, win.y1 - win.y0 + 8)
      ctx.fillStyle = 'rgb(0,14,110)' // glass: glossy, a little mirror-like
      ctx.fillRect(win.x0, win.y0, win.x1 - win.x0, win.y1 - win.y0)
    }, false)
    // Night: a 4 × 4-window pattern of randomly lit rooms (warm and cool
    // interiors), tiled at 1/4 scale so neighbouring windows differ.
    const lit = litWindowTexture(win)
    return new THREE.MeshStandardMaterial({
      map, roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1,
      emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 0,
    })
  })
}

const litCache = new Map<string, THREE.CanvasTexture>()
function litWindowTexture(win: { x0: number; x1: number; y0: number; y1: number }): THREE.CanvasTexture {
  const key = `${win.x0},${win.y0}`
  const hit = litCache.get(key)
  if (hit) return hit
  const S = 128
  const tex = canvasTex(S * 4, S * 4, (ctx) => {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, S * 4, S * 4)
    const tints = ['#ffcf8f', '#ffd9a8', '#ffe8c8', '#cfe0ff', '#ffc070']
    for (let ty = 0; ty < 4; ty++) {
      for (let tx = 0; tx < 4; tx++) {
        if (rand() > 0.45) continue
        const x = tx * S, y = ty * S
        const g = ctx.createLinearGradient(0, y + win.y0, 0, y + win.y1)
        const c = pickOf(tints)
        g.addColorStop(0, c)
        g.addColorStop(1, 'rgba(0,0,0,0.35)')
        ctx.fillStyle = g
        ctx.globalAlpha = 0.45 + rand() * 0.55
        ctx.fillRect(x + win.x0, y + win.y0, win.x1 - win.x0, win.y1 - win.y0)
        ctx.globalAlpha = 1
        // window frame stays dark
        ctx.fillStyle = '#000'
        ctx.fillRect(x + (win.x0 + win.x1) / 2 - 2, y + win.y0, 4, win.y1 - win.y0)
      }
    }
  }, true)
  tex.repeat.set(0.25, 0.25)
  litCache.set(key, tex)
  return tex
}

/** 0 = day, 1 = night: switch on lit windows and bright shop fronts. */
export function setBuildingNightLights(level: number): void {
  for (const [key, m] of matCache) {
    if (key.startsWith('facade|')) m.emissiveIntensity = level * 1.4
    else if (key === 'shopfront') m.emissiveIntensity = 0.4 + level * 3.5
  }
}

/** Ground-floor shop front tile: big display window + door, dark stall riser. */
function shopfrontMaterial(): THREE.MeshStandardMaterial {
  return cachedMat('shopfront', () => {
    const W = 128, H = 128
    const map = canvasTex(W, H, (ctx) => {
      ctx.fillStyle = '#3a3633'
      ctx.fillRect(0, 0, W, H)
      const g = ctx.createLinearGradient(0, 10, 0, 110)
      g.addColorStop(0, '#647380')
      g.addColorStop(0.5, '#2f3a44')
      g.addColorStop(1, '#232b32')
      ctx.fillStyle = g
      ctx.fillRect(8, 10, 112, 98)
      // warm interior glow + shelves
      ctx.fillStyle = 'rgba(255,214,150,0.18)'
      ctx.fillRect(8, 50, 112, 58)
      ctx.fillStyle = 'rgba(30,25,20,0.5)'
      for (let y = 62; y < 108; y += 14) ctx.fillRect(14, y, 100, 2)
      ctx.fillStyle = '#6f6a63'
      ctx.fillRect(62, 10, 4, 98)
      ctx.fillStyle = '#2a2724'
      ctx.fillRect(0, 108, W, 20)
    }, true)
    const rm = canvasTex(W, H, (ctx) => {
      ctx.fillStyle = 'rgb(0,200,0)'
      ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = 'rgb(0,12,90)'
      ctx.fillRect(8, 10, 112, 98)
    }, false)
    return new THREE.MeshStandardMaterial({
      map, roughnessMap: rm, metalnessMap: rm, roughness: 1, metalness: 1,
      emissive: 0x1a1208, emissiveMap: map, emissiveIntensity: 0.4,
    })
  })
}

const plain = (key: string, color: number, roughness: number, metalness = 0) =>
  cachedMat(key, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }))

// ── Geometry helpers ────────────────────────────────────────────────

/** Four outward-facing walls of a W×H×D block, UVs in (bays, floors). */
function walls(w: number, h: number, d: number, y0: number, bayW: number, floorH: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const faces: [number, number, number, number][] = [
    // [width, rotY, offsetX, offsetZ]
    [w, 0, 0, d / 2], [w, Math.PI, 0, -d / 2], [d, Math.PI / 2, w / 2, 0], [d, -Math.PI / 2, -w / 2, 0],
  ]
  for (const [fw, ry, ox, oz] of faces) {
    const g = new THREE.PlaneGeometry(fw, h)
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(fw / bayW)), uv.getY(i) * Math.max(1, Math.round(h / floorH)))
    g.rotateY(ry)
    g.translate(ox, y0 + h / 2, oz)
    parts.push(g)
  }
  return mergeGeometries(parts, false)!
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(x, y, z)
  return g
}

function addMesh(group: THREE.Group, geos: THREE.BufferGeometry[], mat: THREE.Material, cast = true): void {
  if (!geos.length) return
  const geo = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false)
  if (!geo) return
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = cast
  mesh.receiveShadow = true
  group.add(mesh)
}

// ── Building builder ────────────────────────────────────────────────

interface Spec {
  bays: number
  depthBays: number
  floors: number
  ground: 'shop' | 'lobby' | 'none'
  style: 'window' | 'curtain'
  balconies: boolean
  setback: boolean
}

function makeBuilding(s: Spec): THREE.Group {
  const g = new THREE.Group()
  const pal = pickOf(PLASTER)
  const w = s.bays * BAY_W
  const d = s.depthBays * BAY_W
  const groundH = s.ground === 'none' ? 0 : 4.2
  const upperFloors = s.floors - (s.ground === 'none' ? 0 : 1)
  const upperH = upperFloors * FLOOR_H

  const trimMat = plain(`trim|${pal.trim}`, new THREE.Color(pal.trim).getHex(), 0.8)
  const roofMat = plain('roof', 0x55524d, 0.95)
  const darkMat = plain('dark', 0x2a2a2c, 0.6, 0.3)
  const facade = facadeMaterial(pal, s.style)

  // Upper floors (optionally with a setback crown on towers)
  const crownFloors = s.setback ? Math.max(2, Math.floor(upperFloors * 0.2)) : 0
  const mainH = upperH - crownFloors * FLOOR_H
  addMesh(g, [walls(w, mainH, d, groundH, BAY_W, FLOOR_H)], facade)
  let topY = groundH + mainH
  let tw = w, td = d
  if (crownFloors) {
    tw = w * 0.72; td = d * 0.72
    addMesh(g, [walls(tw, crownFloors * FLOOR_H, td, topY, BAY_W, FLOOR_H)], facade)
    addMesh(g, [box(w, 0.5, d, 0, topY + 0.25, 0)], trimMat)
    topY += crownFloors * FLOOR_H
  }

  // Ground floor
  if (s.ground === 'shop') {
    addMesh(g, [walls(w, groundH - 0.6, d, 0, BAY_W * 1.2, groundH - 0.6)], shopfrontMaterial(), false)
    // sign band
    addMesh(g, [box(w + 0.1, 0.6, d + 0.1, 0, groundH - 0.3, 0)], trimMat)
    // awning over the front, sloping down toward the street
    const aw = new THREE.BoxGeometry(w * 0.92, 0.08, 1.6)
    aw.rotateX(-0.28)
    aw.translate(0, groundH - 0.9, d / 2 + 0.75)
    const awMat = plain(`awning|${pickOf(AWNINGS)}`, new THREE.Color(pickOf(AWNINGS)).getHex(), 0.9)
    addMesh(g, [aw], awMat)
  } else if (s.ground === 'lobby') {
    addMesh(g, [walls(w, groundH, d, 0, BAY_W * 1.5, groundH)], shopfrontMaterial(), false)
    addMesh(g, [box(w * 0.4, 0.25, 2.2, 0, groundH - 0.2, d / 2 + 1.1)], darkMat) // entrance canopy
  }

  // Floor slabs / cornice lines every few floors (breaks up the flat box)
  const bands: THREE.BufferGeometry[] = []
  for (let f = 0; f <= upperFloors - crownFloors; f += s.style === 'curtain' ? 100 : 1) {
    if (f === 0 && s.ground === 'none') continue
    if (s.style === 'window' && f % 2 !== 0 && f !== upperFloors - crownFloors) continue
    bands.push(box(w + 0.16, 0.18, d + 0.16, 0, groundH + f * FLOOR_H, 0))
  }
  addMesh(g, bands, trimMat, false)

  // Balconies: slab + railing on alternate bays of the street face
  if (s.balconies) {
    const slabs: THREE.BufferGeometry[] = []
    const rails: THREE.BufferGeometry[] = []
    for (let f = 1; f < upperFloors - crownFloors; f++) {
      for (let b = 0; b < s.bays; b++) {
        if ((b + f) % 2) continue
        const x = -w / 2 + BAY_W * (b + 0.5)
        const y = groundH + f * FLOOR_H - 0.05
        slabs.push(box(BAY_W * 0.8, 0.14, 1.0, x, y, d / 2 + 0.5))
        rails.push(box(BAY_W * 0.8, 0.9, 0.04, x, y + 0.5, d / 2 + 0.98))
      }
    }
    addMesh(g, slabs, trimMat)
    addMesh(g, rails, darkMat)
  }

  // Roof: slab + parapet + rooftop clutter (AC units, water tank / stair box)
  const roof: THREE.BufferGeometry[] = [box(tw, 0.3, td, 0, topY + 0.15, 0)]
  addMesh(g, roof, roofMat, false)
  const parapet: THREE.BufferGeometry[] = [
    box(tw + 0.2, 0.9, 0.25, 0, topY + 0.45, td / 2), box(tw + 0.2, 0.9, 0.25, 0, topY + 0.45, -td / 2),
    box(0.25, 0.9, td, tw / 2, topY + 0.45, 0), box(0.25, 0.9, td, -tw / 2, topY + 0.45, 0),
  ]
  addMesh(g, parapet, trimMat)
  const clutter: THREE.BufferGeometry[] = []
  const units = 1 + Math.floor(rand() * 3)
  for (let i = 0; i < units; i++) {
    clutter.push(box(1.4, 1.0, 1.0, (rand() - 0.5) * tw * 0.6, topY + 0.8, (rand() - 0.5) * td * 0.6))
  }
  if (s.floors > 4) clutter.push(box(2.4, 2.4, 2.4, tw * 0.25, topY + 1.5, -td * 0.2))
  addMesh(g, clutter, plain('metalbox', 0x8d9194, 0.5, 0.6))
  return g
}

const pools = new Map<BuildingKind, THREE.Group>()

/** Template whose userData.variants are many randomised buildings of this kind. */
export function buildingPool(kind: BuildingKind): THREE.Group {
  const hit = pools.get(kind)
  if (hit) return hit
  const variants: THREE.Group[] = []
  const count = kind === 'tower' ? 6 : 10
  for (let i = 0; i < count; i++) {
    if (kind === 'shop') {
      variants.push(makeBuilding({
        bays: 3 + Math.floor(rand() * 3), depthBays: 3, floors: 2 + Math.floor(rand() * 2),
        ground: 'shop', style: 'window', balconies: rand() < 0.3, setback: false,
      }))
    } else if (kind === 'mid') {
      variants.push(makeBuilding({
        bays: 4 + Math.floor(rand() * 3), depthBays: 4, floors: 4 + Math.floor(rand() * 4),
        ground: rand() < 0.5 ? 'shop' : 'lobby', style: 'window', balconies: rand() < 0.6, setback: false,
      }))
    } else {
      const glass = rand() < 0.6
      variants.push(makeBuilding({
        bays: 6 + Math.floor(rand() * 3), depthBays: 6, floors: 14 + Math.floor(rand() * 12),
        ground: 'lobby', style: glass ? 'curtain' : 'window', balconies: false, setback: rand() < 0.5,
      }))
    }
  }
  const pool = variants[0]!.clone()
  pool.userData['variants'] = variants
  pools.set(kind, pool)
  return pool
}
