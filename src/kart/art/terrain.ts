import * as THREE from 'three'
import { GLSL_NOISE } from './atmos'
import { ridged2 } from '../../game/biomes/kit'

const BASE = import.meta.env.BASE_URL
const loader = new THREE.TextureLoader()
const cache = new Map<string, { map: THREE.Texture; nor: THREE.Texture }>()

/** A photo material by short name; 'grass' is the big aerial grass-and-rock set. */
function layerSet(name: string): { map: THREE.Texture; nor: THREE.Texture } {
  const hit = cache.get(name)
  if (hit) return hit
  const load = (url: string, srgb: boolean): THREE.Texture => {
    const t = loader.load(url)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    if (srgb) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  const set = name === 'grass'
    ? { map: load(`${BASE}textures/ground/color.jpg`, true), nor: load(`${BASE}textures/ground/normal.jpg`, false) }
    : { map: load(`${BASE}textures/biomes/${name}_diff.jpg`, true), nor: load(`${BASE}textures/biomes/${name}_nor.jpg`, false) }
  cache.set(name, set)
  return set
}

export interface TerrainStyle {
  /** Four photo layers, blended by the track's splat weights. */
  layers: [string, string, string, string]
  /** Metres per tile of each layer. */
  tile: [number, number, number, number]
  /** Colour multiplied over each layer. */
  tints?: [number, number, number, number]
  roughness?: number
}

/**
 * Photo textures blended per pixel: each layer sampled at two scales so it
 * never shows a repeat, rock projected from the side on steep ground, and the
 * edges between layers broken up by noise rather than fading.
 */
export function terrainMaterial(style: TerrainStyle): THREE.MeshStandardMaterial {
  const sets = style.layers.map(layerSet)
  const tints = (style.tints ?? [0xffffff, 0xffffff, 0xffffff, 0xffffff]).map((c) => new THREE.Color(c))
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: style.roughness ?? 0.94, metalness: 0 })
  mat.onBeforeCompile = (s) => {
    sets.forEach((set, i) => { s.uniforms[`tL${i}`] = { value: set.map }; s.uniforms[`nL${i}`] = { value: set.nor } })
    s.uniforms['uTile'] = { value: new THREE.Vector4(...style.tile.map((t) => 1 / t) as [number, number, number, number]) }
    s.uniforms['uTints'] = { value: tints }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vTw;\nvarying vec3 vTn;\nvarying float vMacro;`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvTw = (modelMatrix * vec4(position, 1.0)).xyz;\nvTn = normal;\nvMacro = aFbm(vTw.xz * 0.045);')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_NOISE}
        uniform sampler2D tL0, tL1, tL2, tL3, nL0, nL1, nL2, nL3;
        uniform vec4 uTile;
        uniform vec3 uTints[4];
        varying vec4 vSplat;
        varying vec3 vTw;
        varying vec3 vTn;
        varying float vMacro;
        vec4 gW;
        vec2 gRock;
        vec3 twoScale(sampler2D t, vec2 p, float n) {
          vec3 a = texture2D(t, p).rgb, b = texture2D(t, p * 0.29 + 0.37).rgb;
          return mix(a, b, 0.32 + n * 0.3);
        }`)
      .replace('#include <map_fragment>', `
        {
          vec3 Nw = normalize(vTn);
          float n = vMacro;
          float fine = aNoise(vTw.xz * 0.6);
          vec4 w = vSplat * (0.75 + vec4(n, fine, 1.0 - n, 1.0 - fine) * 0.6);
          w = pow(max(w, 0.0), vec4(3.0));
          gW = w / max(dot(w, vec4(1.0)), 0.0001);
          // rock is seen from the side on steep ground, not stretched from above
          gRock = Nw.y > 0.72 ? vTw.xz : (abs(Nw.x) > abs(Nw.z) ? vTw.zy : vTw.xy);
          vec3 c = twoScale(tL0, vTw.xz * uTile.x, n) * uTints[0] * gW.x
                 + twoScale(tL1, vTw.xz * uTile.y, n) * uTints[1] * gW.y
                 + twoScale(tL2, gRock * uTile.z, n) * uTints[2] * gW.z
                 + twoScale(tL3, vTw.xz * uTile.w, n) * uTints[3] * gW.w;
          diffuseColor.rgb *= c * (0.84 + n * 0.32);
        }`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 Nw = normalize(vTn);
          vec3 tn = (texture2D(nL0, vTw.xz * uTile.x).xyz * gW.x + texture2D(nL1, vTw.xz * uTile.y).xyz * gW.y
                   + texture2D(nL2, gRock * uTile.z).xyz * gW.z + texture2D(nL3, vTw.xz * uTile.w).xyz * gW.w) * 2.0 - 1.0;
          vec3 T = normalize(cross(vec3(0.0, 0.0, 1.0), Nw));
          vec3 B = cross(Nw, T);
          vec3 nw = normalize(T * tn.x * 1.1 + B * tn.y * 1.1 + Nw * max(tn.z, 0.2));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`)
  }
  mat.customProgramCacheKey = () => `kart-terrain-${style.layers.join()}`
  return mat
}

/**
 * A ring of real mountain silhouettes past the edge of the map: ridged noise
 * on a polar grid, shaded by height, and softened by the fog.
 */
export function mountainRing(root: THREE.Group, cx: number, cz: number, o: { inner: number; outer: number; height: number; base?: number; rock: number; snow?: number; snowLine?: number; seed?: number }): void {
  const A = 640, R = 34
  const pos = new Float32Array((A + 1) * (R + 1) * 3), col = new Float32Array((A + 1) * (R + 1) * 3)
  const rock = new THREE.Color(o.rock), snow = new THREE.Color(o.snow ?? 0xffffff), c = new THREE.Color()
  const seed = o.seed ?? 3, base = o.base ?? -20
  for (let a = 0; a <= A; a++) for (let r = 0; r <= R; r++) {
    const th = ((a % A) / A) * Math.PI * 2, u = r / R
    const rad = o.inner + (o.outer - o.inner) * u
    const x = cx + Math.cos(th) * rad, z = cz + Math.sin(th) * rad
    const px = Math.cos(th) * 3.2 + seed, pz = Math.sin(th) * 3.2 - seed
    const ridge = ridged2(px + u * 1.6, pz + u * 1.6, 6) * 0.86 + ridged2(px * 4.1 + u * 7, pz * 4.1 - u * 7, 4) * 0.14
    const body = Math.sin(u * Math.PI) ** 0.7
    const h = base + o.height * body * (0.3 + ridge * 1.05)
    const k = a * (R + 1) + r
    pos.set([x, h, z], k * 3)
    const hN = (h - base) / o.height
    c.copy(rock).multiplyScalar(0.55 + ridge * 0.7 + (((a * 7 + r * 13) % 5) / 5 - 0.5) * 0.06)
    const line = o.snowLine ?? 0.55
    if (o.snow !== undefined) c.lerp(snow, THREE.MathUtils.smoothstep(hN + (ridge - 0.5) * 0.25, line, line + 0.14))
    col.set([c.r, c.g, c.b], k * 3)
  }
  const idx: number[] = []
  for (let a = 0; a < A; a++) for (let r = 0; r < R; r++) {
    const p = a * (R + 1) + r
    idx.push(p, p + 1, p + R + 1, p + 1, p + R + 2, p + R + 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }))
  m.frustumCulled = false
  root.add(m)
}
