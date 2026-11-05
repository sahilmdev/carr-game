import * as THREE from 'three'
import type { Track } from './Track'
import { bushGeometry } from './Trees'

const UP = new THREE.Vector3(0, 1, 0)

/** Water rectangles (centre x, centre z, width, depth) — no grass there. */
export const WATER_RECTS: [number, number, number, number][] = [
  [750, 275, 700, 1100],
  [170, 585, 480, 520],
]

/**
 * Roadside grass: thousands of instanced grass clumps (two crossed quads
 * with a canvas-drawn blade texture) in a band beside the road through the
 * land biomes. Normals point straight up so the clumps are lit exactly like
 * the ground they grow from, and a vertex shader sways the tips in the wind.
 * Split into 250 m cells so off-screen cells are culled.
 */
export class Vegetation {
  public readonly group = new THREE.Group()
  private shaders: { uniforms: Record<string, THREE.IUniform> }[] = []

  constructor(track: Track, density = 1) {
    const mat = this.makeMaterial()
    const geo = clumpGeometry()
    const half = track.width / 2
    const n = track.sampleCount

    // Spatial hash of track samples so we can keep grass off every road
    const CELL = 20
    const hash = new Map<string, THREE.Vector3[]>()
    for (const p of track.samples) {
      const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
      const list = hash.get(k)
      if (list) list.push(p)
      else hash.set(k, [p])
    }
    const clearOfRoad = (x: number, z: number, clearance: number) => {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL)
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = hash.get(`${cx + dx},${cz + dz}`)
        if (!list) continue
        for (const p of list) if ((p.x - x) ** 2 + (p.z - z) ** 2 < clearance * clearance) return false
      }
      return true
    }
    const inWater = (x: number, z: number) =>
      WATER_RECTS.some(([wx, wz, w, d]) => Math.abs(x - wx) < w / 2 + 4 && Math.abs(z - wz) < d / 2 + 4)

    const cells = new Map<string, THREE.Matrix4[]>()
    const dummy = new THREE.Object3D()
    let seed = 1
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }

    const perSample = Math.round(9 * density)
    for (let i = 0; i < n; i++) {
      const zone = track.zoneOfSample(i)
      if (zone !== 'town' && zone !== 'coast' && zone !== 'canyon') continue
      const p = track.samples[i]!
      if (p.y < -0.5 || p.y > 0.8) continue
      const right = new THREE.Vector3().crossVectors(track.tangents[i]!, UP).normalize()
      const tangent = track.tangents[i]!
      const count = zone === 'canyon' ? Math.ceil(perSample * 0.4) : perSample
      for (let k = 0; k < count; k++) {
        const side = rand() < 0.5 ? -1 : 1
        // Denser close to the shoulder, thinning out further away
        const dist = half + 3.2 + Math.pow(rand(), 1.6) * 30
        const along = (rand() - 0.5) * 3
        const x = p.x + right.x * side * dist + tangent.x * along
        const z = p.z + right.z * side * dist + tangent.z * along
        if (inWater(x, z) || !clearOfRoad(x, z, half + 3)) continue
        dummy.position.set(x, -0.05, z)
        dummy.rotation.set(0, rand() * Math.PI, 0)
        const s = 0.6 + rand() * 0.8
        dummy.scale.set(s, s * (0.7 + rand() * 0.6), s)
        dummy.updateMatrix()
        const key = `${Math.floor(x / 250)},${Math.floor(z / 250)}`
        const list = cells.get(key)
        if (list) list.push(dummy.matrix.clone())
        else cells.set(key, [dummy.matrix.clone()])
      }
    }

    // Bushes: sparse, a little further out than the grass
    const bushMats: THREE.Matrix4[] = []
    for (let i = 0; i < n; i += 3) {
      const zone = track.zoneOfSample(i)
      if (zone !== 'town' && zone !== 'coast' && zone !== 'canyon') continue
      const p = track.samples[i]!
      if (p.y < -0.5 || p.y > 0.8 || rand() > 0.45 * density) continue
      const right = new THREE.Vector3().crossVectors(track.tangents[i]!, UP).normalize()
      const side = rand() < 0.5 ? -1 : 1
      const dist = half + 5 + rand() * 24
      const x = p.x + right.x * side * dist
      const z = p.z + right.z * side * dist
      if (inWater(x, z) || !clearOfRoad(x, z, half + 4)) continue
      dummy.position.set(x, -0.05, z)
      dummy.rotation.set(0, rand() * Math.PI * 2, 0)
      const s = 0.8 + rand() * 0.9
      dummy.scale.set(s, s * (0.7 + rand() * 0.5), s)
      dummy.updateMatrix()
      bushMats.push(dummy.matrix.clone())
    }
    if (bushMats.length) {
      const { geometry, material } = bushGeometry()
      const bushes = new THREE.InstancedMesh(geometry, material, bushMats.length)
      bushMats.forEach((m, i) => bushes.setMatrixAt(i, m))
      bushes.computeBoundingSphere()
      bushes.castShadow = true
      bushes.receiveShadow = true
      this.group.add(bushes)
    }

    for (const mats of cells.values()) {
      const mesh = new THREE.InstancedMesh(geo, mat, mats.length)
      mats.forEach((m, i) => mesh.setMatrixAt(i, m))
      mesh.computeBoundingSphere()
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
  }

  private makeMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      map: bladeTexture(),
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      roughness: 0.9,
      color: 0xd8d8c8,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 }
      this.shaders.push(shader)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
          {
            // Sway the top of each blade; phase varies with world position
            vec4 wp = instanceMatrix * vec4(position, 1.0);
            float sway = sin(uTime * 1.7 + wp.x * 0.15 + wp.z * 0.11) * 0.5
                       + sin(uTime * 2.9 + wp.x * 0.37) * 0.25;
            transformed.x += sway * 0.12 * uv.y * uv.y;
            transformed.z += sway * 0.08 * uv.y * uv.y;
          }`)
    }
    return mat
  }

  update(time: number): void {
    for (const s of this.shaders) s.uniforms['uTime']!.value = time % 1000
  }
}

/** Two crossed 1.2 m × 0.7 m quads, normals up (lit like the ground). */
function clumpGeometry(): THREE.BufferGeometry {
  const w = 0.6, h = 0.7
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let q = 0; q < 2; q++) {
    const a = q * Math.PI / 2
    const cx = Math.cos(a) * w, cz = Math.sin(a) * w
    const b = q * 4
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, h, cz, -cx, h, -cz)
    uv.push(0, 0, 1, 0, 1, 1, 0, 1)
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(8).fill(0).flatMap(() => [0, 1, 0]), 3))
  geo.setIndex(idx)
  return geo
}

/** Canvas texture of ~70 tapered blades in dry-to-green tones, transparent background. */
function bladeTexture(): THREE.CanvasTexture {
  const W = 256, H = 128
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  let seed = 7
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const tones = ['#6f7a3c', '#7d8442', '#8a8a4e', '#5d6b34', '#9a925a', '#6a7538']
  for (let i = 0; i < 70; i++) {
    const x = 6 + rand() * (W - 12)
    const hgt = H * (0.45 + rand() * 0.55)
    const lean = (rand() - 0.5) * 40
    const base = 2 + rand() * 2.5
    ctx.fillStyle = tones[Math.floor(rand() * tones.length)]!
    ctx.beginPath()
    ctx.moveTo(x - base, H)
    ctx.quadraticCurveTo(x + lean * 0.3, H - hgt * 0.5, x + lean, H - hgt)
    ctx.quadraticCurveTo(x + lean * 0.3 + base * 0.5, H - hgt * 0.5, x + base, H)
    ctx.closePath()
    ctx.fill()
  }
  // Darker at the roots (self-shadowing inside the clump)
  ctx.globalCompositeOperation = 'source-atop'
  const g = ctx.createLinearGradient(0, H, 0, 0)
  g.addColorStop(0, 'rgba(20,25,10,0.55)')
  g.addColorStop(0.5, 'rgba(20,25,10,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}
