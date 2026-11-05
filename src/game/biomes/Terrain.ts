import * as THREE from 'three'
import type { Track } from '../Track'
import { rockSet, tiled, photoSet } from '../Textures'
import { RoadIndex, smooth, lerp } from './kit'

/**
 * One terrain "field" per biome: where it applies (weight), its natural
 * height and its surface colour. The terrain blends every field by weight.
 * Masks (vec4) drive shader effects: x = lava glow, y = sand ripples,
 * z = snow sparkle, w = damp / mud darkening.
 */
export interface TerrainField {
  weight(x: number, z: number): number
  height(x: number, z: number): number
  /** Surface colour as sRGB (converted to linear by the terrain). */
  color(x: number, z: number, h: number, slope: number, out: THREE.Color): void
  mask?(x: number, z: number, h: number, out: THREE.Vector4): void
  /** Ground photo: 0 sand, 1 snow, 2 volcanic ash, 3 forest floor */
  surface?: 0 | 1 | 2 | 3
}

/** How the ground meets the road at a sample: cut & fill, bridge, tunnel. */
export type RoadMode = 'fill' | 'bridge' | 'tunnel'

export interface TerrainOptions {
  x0: number
  z0: number
  x1: number
  z1: number
  step: number
  fields: TerrainField[]
  /** Road modes per sample (default 'fill'); null = ignore this sample. */
  roadMode: (i: number) => RoadMode | null
  /** Crown height of a tunnel bore at this point, or null outside one. */
  bore?: (x: number, z: number) => number | null
}

const HIDDEN = -4 // below the base grass plane: the old ground shows instead

/**
 * The big southern landscape (volcano, desert, salt pan, mountains, jungle)
 * as one seamless heightfield, carved to the road everywhere it runs.
 */
export class Terrain {
  readonly group = new THREE.Group()
  private readonly heights: Float32Array
  private readonly nx: number
  private readonly nz: number
  private readonly o: TerrainOptions
  material!: THREE.MeshStandardMaterial
  private shader: { uniforms: Record<string, THREE.IUniform> } | null = null

  constructor(private readonly track: Track, opts: TerrainOptions) {
    this.o = opts
    const { x0, z0, x1, z1, step } = opts
    this.nx = Math.round((x1 - x0) / step) + 1
    this.nz = Math.round((z1 - z0) / step) + 1
    const N = this.nx * this.nz
    this.heights = new Float32Array(N)
    const colors = new Float32Array(N * 3)
    const masks = new Float32Array(N * 4)
    const surfs = new Float32Array(N * 4)
    const weights = new Float32Array(N * opts.fields.length)

    // 1. Natural heights (weighted blend of fields; nothing = hidden)
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const x = x0 + i * step, z = z0 + j * step
        const k = j * this.nx + i
        let wSum = 0, h = 0
        opts.fields.forEach((f, fi) => {
          const w = f.weight(x, z)
          weights[k * opts.fields.length + fi] = w
          if (w > 1e-4) { wSum += w; h += w * f.height(x, z) }
        })
        // the filler field (weight ~0.12) alone is enough to show ground
        const cover = Math.min(1, wSum * 8)
        h = wSum > 1e-4 ? h / wSum : HIDDEN
        h = lerp(HIDDEN, h, cover)
        // fade out at the region border
        const edge = Math.min(x - x0, x1 - x, z - z0, z1 - z)
        h = lerp(HIDDEN, h, smooth(0, 70, edge))
        this.heights[k] = h
      }
    }

    // 2. Carve to the road
    this.carve()

    // 3. Colours + masks from the final shape
    const col = new THREE.Color(), acc = new THREE.Color()
    const m = new THREE.Vector4(), mAcc = new THREE.Vector4()
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i
        const x = x0 + i * step, z = z0 + j * step
        const h = this.heights[k]!
        const slope = this.slopeAt(i, j)
        acc.setRGB(0, 0, 0)
        mAcc.set(0, 0, 0, 0)
        let wSum = 0
        opts.fields.forEach((f, fi) => {
          const w = weights[k * opts.fields.length + fi]!
          if (w < 1e-4) return
          f.color(x, z, h, slope, col)
          col.convertSRGBToLinear()
          acc.r += col.r * w; acc.g += col.g * w; acc.b += col.b * w
          if (f.mask) { m.set(0, 0, 0, 0); f.mask(x, z, h, m); mAcc.addScaledVector(m, w) }
          if (f.surface !== undefined) surfs[k * 4 + f.surface]! += w
          wSum += w
        })
        if (wSum > 0) { acc.multiplyScalar(1 / wSum); mAcc.multiplyScalar(1 / wSum) } else acc.setRGB(0.3, 0.3, 0.25)
        // photos lie on the gentle ground; cliffs keep their rock colour
        const flat = wSum > 0 ? (1 - smooth(0.65, 1.1, slope)) / wSum : 0
        for (let c = 0; c < 4; c++) surfs[k * 4 + c]! *= flat
        colors[k * 3] = acc.r; colors[k * 3 + 1] = acc.g; colors[k * 3 + 2] = acc.b
        masks[k * 4] = mAcc.x; masks[k * 4 + 1] = mAcc.y; masks[k * 4 + 2] = mAcc.z; masks[k * 4 + 3] = mAcc.w
      }
    }

    this.buildMaterial()
    this.buildChunks(colors, masks, surfs)
  }

  /** Bilinear height of the finished terrain (HIDDEN outside it). */
  heightAt(x: number, z: number): number {
    const { x0, z0, step } = this.o
    const fx = (x - x0) / step, fz = (z - z0) / step
    if (fx < 0 || fz < 0 || fx > this.nx - 1 || fz > this.nz - 1) return HIDDEN
    const i = Math.min(this.nx - 2, Math.floor(fx)), j = Math.min(this.nz - 2, Math.floor(fz))
    const tx = fx - i, tz = fz - j
    const H = this.heights
    const a = H[j * this.nx + i]!, b = H[j * this.nx + i + 1]!
    const c = H[(j + 1) * this.nx + i]!, d = H[(j + 1) * this.nx + i + 1]!
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz)
  }

  /** Surface normal from the height grid. */
  normalAt(x: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = this.o.step
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize()
  }

  private slopeAt(i: number, j: number): number {
    const H = this.heights, nx = this.nx
    const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1)
    const j0 = Math.max(0, j - 1), j1 = Math.min(this.nz - 1, j + 1)
    const dx = (H[j * nx + i1]! - H[j * nx + i0]!) / ((i1 - i0) * this.o.step)
    const dz = (H[j1 * nx + i]! - H[j0 * nx + i]!) / ((j1 - j0) * this.o.step)
    return Math.hypot(dx, dz)
  }

  private carve(): void {
    const { x0, z0, step } = this.o
    const index = new RoadIndex(this.track, 24)
    const half = this.track.width / 2
    const inner = half + 2.5
    const outer = inner + 30
    const filter = (i: number) => this.o.roadMode(i) !== null
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i
        const x = x0 + i * step, z = z0 + j * step
        const near = index.nearest(x, z, outer, filter)
        if (near.i < 0) continue
        const mode = this.o.roadMode(near.i)!
        const ry = this.track.samples[near.i]!.y
        const h0 = this.heights[k]!
        const t = smooth(inner, outer, near.d)
        if (mode === 'fill') {
          // a little shoulder drop so the verge sits just under the asphalt
          this.heights[k] = lerp(ry - 0.45 - smooth(half, inner, near.d) * 0.4, h0, t)
        } else if (mode === 'bridge') {
          this.heights[k] = Math.min(h0, lerp(ry - 3, h0 + 50, t))
        } else {
          // tunnel: keep at least a solid roof over the bore
          const roof = ry + 13
          this.heights[k] = near.d < inner + 4 ? Math.max(h0, roof) : Math.max(h0, lerp(roof, h0, smooth(inner + 4, outer, near.d)))
        }
      }
    }
  }

  private buildMaterial(): void {
    const rock = tiled(rockSet(), 1, 1)
    rock.normalMap.wrapS = rock.normalMap.wrapT = THREE.RepeatWrapping
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      normalMap: rock.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.95,
      metalness: 0,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 }
      shader.uniforms['tSand'] = { value: photoSet('coast_sand_01').map }
      shader.uniforms['tSnow'] = { value: photoSet('snow_02').map }
      shader.uniforms['tAsh'] = { value: photoSet('moon_01').map }
      shader.uniforms['tForest'] = { value: photoSet('forest_floor').map }
      this.shader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aMask;\nattribute vec4 aSurf;\nvarying vec4 vMask;\nvarying vec4 vSurf;\nvarying vec3 vTWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMask = aMask;\nvSurf = aSurf;\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        // world-space uv for the detail normal map (8 m tiles)
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_NORMALMAP\nvNormalMapUv = (modelMatrix * vec4(position, 1.0)).xz / 8.0;\n#endif')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          varying vec4 vMask;
          varying vec4 vSurf;
          varying vec3 vTWorld;
          uniform float uTime;
          uniform sampler2D tSand, tSnow, tAsh, tForest;
          // two scales so the photo never shows a repeat from a distance
          vec3 photo(sampler2D t, vec2 p) { return texture2D(t, p / 5.0).rgb * 0.6 + texture2D(t, p / 23.0 + 0.37).rgb * 0.4; }
          float th(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float tn(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(th(i), th(i + vec2(1.0, 0.0)), f.x), mix(th(i + vec2(0.0, 1.0)), th(i + vec2(1.0, 1.0)), f.x), f.y);
          }
          float tfbm(vec2 p) { return tn(p) * 0.5 + tn(p * 2.1 + 3.7) * 0.3 + tn(p * 4.3 + 9.1) * 0.2; }`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          {
            vec2 wp = vTWorld.xz;
            // two scales of mottling so the 5 m vertex colours never read as flat
            float m1 = tfbm(wp * 0.07);
            float m2 = tfbm(wp * 0.6);
            diffuseColor.rgb *= 0.78 + m1 * 0.32 + m2 * 0.18;
            // damp / mud darkening
            diffuseColor.rgb *= 1.0 - vMask.w * 0.45 * (0.6 + m2 * 0.4);
            // real ground photos, tinted toward the biome's own colour
            float ws = vSurf.x + vSurf.y + vSurf.z + vSurf.w;
            if (ws > 0.01) {
              vec3 ph = vec3(0.0);
              if (vSurf.x > 0.01) ph += photo(tSand, wp) * vec3(1.12, 0.98, 0.8) * vSurf.x;
              if (vSurf.y > 0.01) ph += photo(tSnow, wp) * 1.1 * vSurf.y;
              if (vSurf.z > 0.01) ph += photo(tAsh, wp) * 0.3 * vSurf.z;
              if (vSurf.w > 0.01) ph += photo(tForest, wp) * vec3(0.8, 1.0, 0.65) * vSurf.w;
              diffuseColor.rgb = mix(diffuseColor.rgb, ph / ws, min(ws, 1.0) * 0.85);
            }
          }`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
          // wind ripples on sand: crests ~0.9 m apart, wandering
          if (vMask.y > 0.02) {
            vec2 wp = vTWorld.xz;
            float ph = dot(wp, vec2(0.8, 0.6)) * 7.0 + tn(wp * 0.15) * 9.0;
            float rp = cos(ph);
            vec3 rn = normalize(vec3(0.8, 0.0, 0.6)) * rp * 0.22 * vMask.y;
            normal = normalize(normal + (viewMatrix * vec4(rn, 0.0)).xyz);
          }`)
        .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.55, vMask.w * 0.6);`)
        .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
          {
            vec2 wp = vTWorld.xz;
            // lava: glowing cracks that slowly pulse
            if (vMask.x > 0.01) {
              float c = abs(tn(wp * 0.25 + 3.1) - 0.5) + abs(tn(wp * 0.9) - 0.5) * 0.5;
              float crack = smoothstep(0.08, 0.0, c) * vMask.x;
              float pulse = 0.75 + 0.25 * sin(uTime * 1.3 + tn(wp * 0.05) * 12.0);
              totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * crack * 3.0 * pulse;
            }
            // snow: tiny sun glints
            if (vMask.z > 0.01) {
              float s = step(0.996, th(floor(wp * 9.0)));
              totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * s * vMask.z * 0.8;
            }
          }`)
    }
    this.material = mat
  }

  private buildChunks(colors: Float32Array, masks: Float32Array, surfs: Float32Array): void {
    const CH = 64 // cells per chunk side
    const { x0, z0, step } = this.o
    for (let cj = 0; cj < this.nz - 1; cj += CH) {
      for (let ci = 0; ci < this.nx - 1; ci += CH) {
        const ni = Math.min(CH, this.nx - 1 - ci) + 1
        const nj = Math.min(CH, this.nz - 1 - cj) + 1
        // skip chunks that are entirely hidden under the base ground
        let any = false
        for (let j = 0; j < nj && !any; j++) for (let i = 0; i < ni; i++) if (this.heights[(cj + j) * this.nx + ci + i]! > HIDDEN + 0.5) { any = true; break }
        if (!any) continue
        const pos = new Float32Array(ni * nj * 3)
        const nrm = new Float32Array(ni * nj * 3)
        const col = new Float32Array(ni * nj * 3)
        const msk = new Float32Array(ni * nj * 4)
        const srf = new Float32Array(ni * nj * 4)
        const n = new THREE.Vector3()
        for (let j = 0; j < nj; j++) {
          for (let i = 0; i < ni; i++) {
            const gi = ci + i, gj = cj + j
            const k = gj * this.nx + gi
            const v = j * ni + i
            const x = x0 + gi * step, z = z0 + gj * step
            pos[v * 3] = x; pos[v * 3 + 1] = this.heights[k]!; pos[v * 3 + 2] = z
            this.normalAt(x, z, n)
            nrm[v * 3] = n.x; nrm[v * 3 + 1] = n.y; nrm[v * 3 + 2] = n.z
            col[v * 3] = colors[k * 3]!; col[v * 3 + 1] = colors[k * 3 + 1]!; col[v * 3 + 2] = colors[k * 3 + 2]!
            for (let c = 0; c < 4; c++) { msk[v * 4 + c] = masks[k * 4 + c]!; srf[v * 4 + c] = surfs[k * 4 + c]! }
          }
        }
        const idx: number[] = []
        for (let j = 0; j < nj - 1; j++) {
          for (let i = 0; i < ni - 1; i++) {
            const a = j * ni + i, b = a + 1, c = a + ni, d = c + 1
            // skip quads fully under the base ground
            const hmax = Math.max(pos[a * 3 + 1]!, pos[b * 3 + 1]!, pos[c * 3 + 1]!, pos[d * 3 + 1]!)
            if (hmax < -0.3) continue
            // a heightfield can't have a hole in its side: open the quads
            // that would otherwise wall off a tunnel mouth
            if (this.o.bore) {
              const hmin = Math.min(pos[a * 3 + 1]!, pos[b * 3 + 1]!, pos[c * 3 + 1]!, pos[d * 3 + 1]!)
              const crown = Math.max(...[a, b, c, d].map((q) => this.o.bore!(pos[q * 3]!, pos[q * 3 + 2]!) ?? -1e6))
              if (hmin < crown) continue
            }
            idx.push(a, c, b, b, c, d)
          }
        }
        if (!idx.length) continue
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
        g.setAttribute('color', new THREE.BufferAttribute(col, 3))
        g.setAttribute('aMask', new THREE.BufferAttribute(msk, 4))
        g.setAttribute('aSurf', new THREE.BufferAttribute(srf, 4))
        // uv is unused (world-space detail) but the normal map chunk wants one
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(ni * nj * 2), 2))
        g.setIndex(idx)
        g.computeBoundingSphere()
        const mesh = new THREE.Mesh(g, this.material)
        mesh.receiveShadow = true
        mesh.castShadow = false
        this.group.add(mesh)
      }
    }
  }

  update(time: number): void {
    if (this.shader) this.shader.uniforms['uTime']!.value = time % 1000
  }
}
