import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

/**
 * Code-generated trees: tapered bark trunks with branches and crowns made
 * of many alpha-tested leaf cards. Card normals point away from the crown
 * centre, so the whole crown shades like a soft volume (lit side bright,
 * far side dark) instead of flat billboards.
 *
 * treePool(kind) returns a template whose userData.variants holds several
 * random trees, picked per placement by Scenery.placeModel().
 */
export type TreeKind = 'broadleaf' | 'palm'

let seed = 4242
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (color) t.colorSpace = THREE.SRGBColorSpace
  return t
}

// ── Materials ───────────────────────────────────────────────────────

let barkMat: THREE.MeshStandardMaterial | null = null
function bark(): THREE.MeshStandardMaterial {
  if (barkMat) return barkMat
  const map = canvasTex(64, 128, (ctx) => {
    ctx.fillStyle = '#5a4a3a'
    ctx.fillRect(0, 0, 64, 128)
    for (let i = 0; i < 70; i++) {
      const x = rand() * 64
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(30,22,15,0.55)' : 'rgba(120,105,85,0.35)'
      ctx.lineWidth = 1 + rand() * 2
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.bezierCurveTo(x + (rand() - 0.5) * 8, 40, x + (rand() - 0.5) * 8, 90, x + (rand() - 0.5) * 6, 128)
      ctx.stroke()
    }
  })
  barkMat = new THREE.MeshStandardMaterial({ map, roughness: 0.95 })
  return barkMat
}

let leafMat: THREE.MeshStandardMaterial | null = null
/** Card texture: a cluster of ~40 leaves in mixed greens on transparent. */
function leaves(): THREE.MeshStandardMaterial {
  if (leafMat) return leafMat
  const S = 256
  const map = canvasTex(S, S, (ctx) => {
    const greens = ['#3f5a2a', '#4d6b31', '#5b7a38', '#36502a', '#6a8a42', '#47612e']
    for (let i = 0; i < 46; i++) {
      const cx = S / 2 + (rand() - 0.5) * S * 0.75
      const cy = S / 2 + (rand() - 0.5) * S * 0.75
      const len = 22 + rand() * 22
      const ang = rand() * Math.PI * 2
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(ang)
      ctx.fillStyle = greens[Math.floor(rand() * greens.length)]!
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.quadraticCurveTo(len * 0.5, -len * 0.32, len, 0)
      ctx.quadraticCurveTo(len * 0.5, len * 0.32, 0, 0)
      ctx.fill()
      ctx.strokeStyle = 'rgba(30,40,15,0.5)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, 0); ctx.stroke()
      ctx.restore()
    }
  })
  leafMat = new THREE.MeshStandardMaterial({
    map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75,
  })
  return leafMat
}

let frondMat: THREE.MeshStandardMaterial | null = null
/** Palm frond: a central rib with many thin leaflets angled outward. */
function frond(): THREE.MeshStandardMaterial {
  if (frondMat) return frondMat
  const W = 64, H = 256
  const map = canvasTex(W, H, (ctx) => {
    ctx.strokeStyle = '#6b6a3a'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(W / 2, H); ctx.lineTo(W / 2, 0); ctx.stroke()
    for (let y = H - 6; y > 4; y -= 5) {
      const t = 1 - y / H
      const len = (W / 2 - 2) * Math.sin(Math.min(1, (1 - t) * 1.6) * Math.PI * 0.5) * (0.85 + rand() * 0.15)
      ctx.strokeStyle = rand() < 0.5 ? '#4e6b2c' : '#5f7d36'
      ctx.lineWidth = 2.2
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(W / 2, y)
        ctx.lineTo(W / 2 + s * len, y - len * 0.5)
        ctx.stroke()
      }
    }
  })
  frondMat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 })
  return frondMat
}

// ── Geometry helpers ────────────────────────────────────────────────

/** Tapered cylinder along a list of points (radius r0 → r1). */
function limb(points: THREE.Vector3[], r0: number, r1: number, radial = 7): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    const len = a.distanceTo(b)
    const ra = r0 + (r1 - r0) * (i / (points.length - 1))
    const rb = r0 + (r1 - r0) * ((i + 1) / (points.length - 1))
    const g = new THREE.CylinderGeometry(rb, ra, len, radial, 1, true)
    g.translate(0, len / 2, 0)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
    g.applyQuaternion(q)
    g.translate(a.x, a.y, a.z)
    // stretch the bark texture along the segment
    const uv = g.getAttribute('uv') as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * len * 0.5 + i)
    parts.push(g)
  }
  return mergeGeometries(parts, false)!
}

/** A square leaf card centred at `c`, random orientation, normals pointing out of the crown. */
function leafCard(c: THREE.Vector3, size: number, crown: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size)
  g.rotateX(rand() * Math.PI)
  g.rotateY(rand() * Math.PI * 2)
  g.rotateZ((rand() - 0.5) * 0.8)
  g.translate(c.x, c.y, c.z)
  const out = c.clone().sub(crown).normalize()
  const n = g.getAttribute('normal') as THREE.BufferAttribute
  for (let k = 0; k < n.count; k++) n.setXYZ(k, out.x, out.y, out.z)
  return g
}

function group(parts: [THREE.BufferGeometry[], THREE.Material, boolean][]): THREE.Group {
  const g = new THREE.Group()
  for (const [geos, mat, cast] of parts) {
    if (!geos.length) continue
    const m = new THREE.Mesh(mergeGeometries(geos, false)!, mat)
    m.castShadow = cast
    m.receiveShadow = true
    g.add(m)
  }
  return g
}

// ── Tree builders ───────────────────────────────────────────────────

/** Deciduous street tree, ~7–10 m: trunk, 4–6 branches, leafy crown. */
function broadleaf(): THREE.Group {
  const h = 3.2 + rand() * 1.2
  const lean = new THREE.Vector3((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4)
  const trunkPts = [0, 0.33, 0.66, 1].map((t) => new THREE.Vector3(lean.x * t * t, h * t, lean.z * t * t))
  const wood: THREE.BufferGeometry[] = [limb(trunkPts, 0.28, 0.16)]
  const crown = new THREE.Vector3(lean.x, h + 2.4, lean.z)
  const cards: THREE.BufferGeometry[] = []
  const branches = 4 + Math.floor(rand() * 3)
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * Math.PI * 2 + rand() * 0.6
    const start = new THREE.Vector3(lean.x * 0.8, h * (0.75 + rand() * 0.2), lean.z * 0.8)
    const dir = new THREE.Vector3(Math.cos(a), 0.9 + rand() * 0.6, Math.sin(a)).normalize()
    const len = 2 + rand() * 1.4
    const mid = start.clone().addScaledVector(dir, len * 0.5)
    const end = start.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, 0.3, 0))
    wood.push(limb([start, mid, end], 0.12, 0.05, 5))
    // leaf clumps along and at the end of each branch
    for (let k = 0; k < 9; k++) {
      const p = end.clone().add(new THREE.Vector3((rand() - 0.5) * 2.4, (rand() - 0.3) * 1.8, (rand() - 0.5) * 2.4))
      cards.push(leafCard(p, 1.5 + rand() * 0.6, crown))
    }
  }
  // fill the crown volume
  for (let k = 0; k < 26; k++) {
    const p = crown.clone().add(new THREE.Vector3((rand() - 0.5) * 3.6, (rand() - 0.5) * 2.6, (rand() - 0.5) * 3.6))
    cards.push(leafCard(p, 1.6 + rand() * 0.6, crown))
  }
  return group([[wood, bark(), true], [cards, leaves(), true]])
}

/** Coastal palm, ~8–11 m: curved ringed trunk, crown of drooping fronds. */
function palm(): THREE.Group {
  const h = 6.5 + rand() * 2.5
  const bendDir = new THREE.Vector3(rand() - 0.5, 0, rand() - 0.5).normalize()
  const bend = 0.8 + rand() * 1.4
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    pts.push(new THREE.Vector3(0, h * t, 0).addScaledVector(bendDir, bend * t * t))
  }
  const trunk = limb(pts, 0.26, 0.17, 8)
  const top = pts[pts.length - 1]!
  const fronds: THREE.BufferGeometry[] = []
  const count = 9 + Math.floor(rand() * 4)
  for (let f = 0; f < count; f++) {
    const a = (f / count) * Math.PI * 2 + rand() * 0.3
    const L = 3.6 + rand() * 1.2
    const W = 0.9
    // strip of 6 segments drooping in an arc
    const g = new THREE.PlaneGeometry(W, L, 1, 6)
    g.translate(0, L / 2, 0)
    const pos = g.getAttribute('position') as THREE.BufferAttribute
    const up0 = 0.5 + rand() * 0.5 // initial upward angle
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) / L // 0 at the trunk → 1 at the tip
      const ang = up0 - y * (1.6 + rand() * 0.05) // droops toward the tip
      const r = y * L
      pos.setXYZ(k, pos.getX(k), Math.sin(ang) * r * 0.6, Math.cos(ang) * r * 0.85 + 0.15)
    }
    g.computeVertexNormals()
    g.rotateY(a)
    g.translate(top.x, top.y, top.z)
    // light the fronds like a canopy (normals up/outward)
    const n = g.getAttribute('normal') as THREE.BufferAttribute
    const out = new THREE.Vector3(Math.sin(a), 1.2, Math.cos(a)).normalize()
    for (let k = 0; k < n.count; k++) n.setXYZ(k, out.x, out.y, out.z)
    fronds.push(g)
  }
  // coconut cluster
  const nuts: THREE.BufferGeometry[] = []
  for (let k = 0; k < 4; k++) {
    const s = new THREE.SphereGeometry(0.15, 6, 5)
    s.translate(top.x + (rand() - 0.5) * 0.4, top.y - 0.2, top.z + (rand() - 0.5) * 0.4)
    nuts.push(s)
  }
  return group([[[trunk], bark(), true], [fronds, frond(), true], [nuts, bark(), false]])
}

const pools = new Map<TreeKind, THREE.Group>()

/** Template whose userData.variants are several random trees of this kind. */
export function treePool(kind: TreeKind): THREE.Group {
  const hit = pools.get(kind)
  if (hit) return hit
  const variants: THREE.Group[] = []
  for (let i = 0; i < 6; i++) variants.push(kind === 'palm' ? palm() : broadleaf())
  const pool = variants[0]!.clone()
  pool.userData['variants'] = variants
  pools.set(kind, pool)
  return pool
}

/** A low roadside bush (one merged geometry) for instancing. */
export function bushGeometry(): { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial } {
  const centre = new THREE.Vector3(0, 0.55, 0)
  const cards: THREE.BufferGeometry[] = []
  for (let k = 0; k < 14; k++) {
    const p = new THREE.Vector3((rand() - 0.5) * 1.6, 0.25 + rand() * 0.8, (rand() - 0.5) * 1.6)
    cards.push(leafCard(p, 0.9 + rand() * 0.4, centre))
  }
  return { geometry: mergeGeometries(cards, false)!, material: leaves() }
}
