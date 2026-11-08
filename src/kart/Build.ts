import * as THREE from 'three'
import { asphaltSet, tiled } from '../game/Textures'
import { trs, canvasTexture } from '../game/biomes/kit'
import { GLSL_NOISE } from './art/atmos'
import { terrainMaterial } from './art/terrain'
import { buildWater, type Water } from './art/water'
import { Mesher, surface } from './art/arch'
import type { Circuit } from './Circuit'
import type { World } from './World'
import type { TrackDef } from './types'

export interface Base { water: Water | null; road: RoadControl }

/** What a track can change on its road during a race. */
export interface RoadControl { mat: THREE.MeshStandardMaterial; wet: { value: number } }

/** The road, its edges, rails and supports, the ground and any water. */
export function buildBase(def: TrackDef, c: Circuit, w: World, root: THREE.Group): Base {
  const road = buildRoad(def, c, root)
  for (const p of c.all) {
    if (p !== c) buildRoad(def, p, root, road)
    buildVerge(def, p, root)
    buildRails(def, p, root)
    buildPads(p, root)
    if ((def.piers ?? 'concrete') === 'concrete') buildSupports(p, w, root)
  }
  buildStart(c, root)
  buildGround(def, w, root)
  const water = def.sea !== undefined && def.water ? buildWater(w, root, def.sea, def.water) : null
  return { water, road }
}

function edge(c: Circuit, i: number, lat: number, y = 0): THREE.Vector3 {
  const p = c.samples[i]!, r = c.rights[i]!
  return new THREE.Vector3(p.x + r.x * lat, p.y + lat * Math.tan(c.banks[i]!) + y, p.z + r.z * lat)
}

const ROAD_GLSL = /* glsl */ `
  ${GLSL_NOISE}
  varying vec2 vRoad;
  varying vec4 vInfo;
  uniform sampler2D tDirt;
  uniform float uWet;
  uniform float uDash;
  uniform vec3 uKerbA, uKerbB, uEdgeLine, uGrime, uTone, uSheen;
  uniform float uLift;
  float gRough;
  float gMetal;
  float gNorm;
  float gWetMask;
`

const ROAD_MAP = /* glsl */ `
  {
    float lat = vRoad.x, along = vRoad.y, half_ = vInfo.x, e = half_ - abs(lat);
    int deck = int(vInfo.w + 0.5);
    float big = aFbm(vec2(lat * 0.11, along * 0.035));
    float fine = aNoise(vec2(lat * 3.1, along * 1.7));
    vec3 c;
    gRough = 0.9;
    gMetal = 0.0;
    gNorm = deck == 0 ? 1.0 : deck == 1 ? 0.8 : deck == 2 ? 0.3 : deck == 3 ? 0.07 : deck == 4 ? 0.1 : 0.03;
    if (deck == 1) {
      // packed dirt with two worn ruts
      c = texture2D(tDirt, vec2(lat, along) * 0.11).rgb * 0.5 + texture2D(tDirt, vec2(lat, along) * 0.031).rgb * 0.5;
      float rut = exp(-pow((abs(lat - vInfo.z) - 2.1) / 0.8, 2.0));
      c *= 1.0 - rut * 0.26;
      c *= (0.82 + big * 0.36) * uTone;
      gRough = 0.97;
    } else if (deck == 2) {
      // planks laid across the road, each its own colour
      float id = floor(along / 1.15);
      float seam = smoothstep(0.0, 0.05, fract(along / 1.15)) * smoothstep(1.0, 0.95, fract(along / 1.15));
      float grain = aNoise(vec2(lat * 0.8 + id * 9.0, along * 11.0));
      float tone = 0.62 + aHash(vec2(id, 3.0)) * 0.5;
      c = vec3(0.44, 0.3, 0.19) * tone * (0.72 + grain * 0.52);
      c *= mix(0.22, 1.0, seam);
      c *= 1.0 - exp(-pow((abs(lat - vInfo.z) - 2.1) / 1.0, 2.0)) * 0.2;
      gRough = 0.8;
    } else if (deck == 3) {
      // clear blue ice, scored by runners
      float cracks = 0.0;
      float score = smoothstep(0.66, 0.84, aNoise(vec2(lat * 9.0, along * 0.05)));
      c = mix(vec3(0.5, 0.74, 0.9), vec3(0.8, 0.92, 0.98), big);
      c = mix(c, vec3(0.96, 0.99, 1.0), score * 0.45 + cracks * 0.7);
      gRough = 0.12 + score * 0.3;
    } else if (deck == 4) {
      // raised steel plate
      vec2 q = vec2(lat, along) / 0.5;
      vec2 f = fract(q + vec2(0.5 * mod(floor(q.y), 2.0), 0.0)) - 0.5;
      float tread = smoothstep(0.34, 0.28, length(f * vec2(1.0, 2.6)));
      float plate = smoothstep(0.0, 0.03, fract(along / 6.0));
      c = vec3(0.3, 0.32, 0.35) * (0.8 + tread * 0.34) * mix(0.4, 1.0, plate) * (0.78 + big * 0.44);
      gRough = 0.46;
      gMetal = 0.72;
    } else if (deck == 5) {
      // dark glass, lit from below by a line of strips
      float strip = smoothstep(0.06, 0.0, abs(fract(along / 8.0) - 0.5)) * 0.5;
      c = mix(vec3(0.015, 0.03, 0.04), uEdgeLine * 0.5, strip);
      gRough = 0.05;
      gMetal = 0.2;
    } else {
      vec3 t0 = diffuseColor.rgb * texture2D(map, vMapUv).rgb;
      vec3 t1 = texture2D(map, vMapUv * 0.37 + 0.13).rgb;
      c = mix(t0, t1, 0.35) * uTone;
      // old patches of newer tarmac
      vec2 cell = floor(vec2(lat / 5.0 + 40.0, along / 18.0));
      float has = step(0.84, aHash(cell));
      vec2 pf = abs(fract(vec2(lat / 5.0, along / 18.0)) - 0.5);
      float patch_ = has * smoothstep(0.46, 0.43, max(pf.x, pf.y));
      c = mix(c, c * 0.62, patch_);
      // rubber laid down on the racing line, and streaks along the road
      float line = exp(-pow((lat - vInfo.z) / 2.6, 2.0));
      c *= 1.0 - line * 0.3 * (0.72 + big * 0.5);
      float streak = smoothstep(0.62, 0.78, aNoise(vec2(lat * 1.3, along * 0.04)));
      c *= 1.0 - streak * 0.16;
      c *= 0.84 + big * 0.32;
      gRough = 0.9 - line * 0.14;
    }
    // dirt and dust gathered at the road edge
    float grime = smoothstep(2.4, 0.0, e + (big - 0.5) * 2.4);
    if (deck != 5) c = mix(c, uGrime, grime * 0.62);
    // painted edge lines, worn by traffic
    float wear = 0.74 + fine * 0.3;
    if (deck == 0) {
      float ln = smoothstep(0.62, 0.58, e) * smoothstep(0.36, 0.4, e) * step(0.2, vInfo.y * -1.0 + 1.0);
      c = mix(c, uEdgeLine, ln * wear);
      float dash = step(fract(along / 9.0), 0.42) * uDash;
      c = mix(c, vec3(0.86, 0.86, 0.83), smoothstep(0.16, 0.13, abs(lat)) * dash * wear);
    }
    // kerbs on the bends
    float kerb = smoothstep(0.02, 0.2, vInfo.y) * smoothstep(1.75, 1.7, e);
    if (kerb > 0.0) {
      float stripe = step(0.5, fract(along / 5.2));
      vec3 k = mix(uKerbA, uKerbB, stripe) * (0.8 + fine * 0.28);
      c = mix(c, k, kerb);
      gRough = mix(gRough, 0.6, kerb);
    }
    // standing water
    float pool = smoothstep(0.5, 0.64, aFbm(vec2(lat * 0.16 + 3.0, along * 0.05))) * uWet;
    gWetMask = clamp(uWet * 0.55 + pool, 0.0, 1.0);
    c *= 1.0 - gWetMask * 0.42;
    diffuseColor.rgb = c + uLift * c;
  }
`

function buildRoad(def: TrackDef, c: Circuit, root: THREE.Group, shared?: RoadControl): RoadControl {
  const n = c.count, style = def.road ?? {}, last = c.closed ? n : n - 1
  const pos: number[] = [], uv: number[] = [], info: number[] = [], idx: number[] = [], road: number[] = []
  const side: number[] = [], sideIdx: number[] = []
  const col: number[] = []
  // where the fastest line runs: inside of the bends, drifting back out between
  const raw = new Float32Array(n), line = new Float32Array(n)
  for (let i = 0; i < n; i++) raw[i] = -THREE.MathUtils.clamp(c.bends[i]! * 260, -1, 1) * (c.widths[i]! / 2 - 3)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = -14; k <= 14; k++) s += raw[c.closed ? (i + k + n) % n : Math.max(0, Math.min(n - 1, i + k))]!
    line[i] = s / 29
  }
  let along = 0
  const kerbs = style.kerb !== false && (style.lines ?? 'circuit') === 'circuit'
  for (let i = 0; i <= last; i++) {
    const k = i % n, half = c.widths[k]! / 2
    const a = edge(c, k, -half, 0.02), b = edge(c, k, half, 0.02), m = edge(c, k, 0, 0.02)
    const kerb = kerbs && !c.raised[k] ? THREE.MathUtils.smoothstep(Math.abs(c.bends[k]!), 0.0035, 0.0065) : 0
    pos.push(a.x, a.y, a.z, m.x, m.y, m.z, b.x, b.y, b.z)
    road.push(-half, along, 0, along, half, along)
    uv.push(0, along / 10, 0.5, along / 10, 1, along / 10)
    for (let q = 0; q < 3; q++) info.push(half, kerb, line[k]!, c.deck[k]!)
    along += 2
    if (i < last && !c.gap[k]) {
      const o = i * 3
      idx.push(o, o + 1, o + 3, o + 1, o + 4, o + 3, o + 1, o + 2, o + 4, o + 2, o + 5, o + 4)
    }
    const d = c.raised[k] ? 1.5 : 0.8
    side.push(a.x, a.y, a.z, a.x, a.y - d * 0.5, a.z, a.x + c.rights[k]!.x * 1.2, a.y - d, a.z + c.rights[k]!.z * 1.2, b.x - c.rights[k]!.x * 1.2, b.y - d, b.z - c.rights[k]!.z * 1.2, b.x, b.y - d * 0.5, b.z, b.x, b.y, b.z)
    const tone = c.deck[k] === 2 ? 0x4a3524 : c.deck[k] === 3 ? 0xbfd8e6 : 0x8d9096
    const cc = new THREE.Color(tone)
    for (let q = 0; q < 6; q++) col.push(cc.r, cc.g, cc.b)
    if (i < last && !c.gap[k]) for (let q = 0; q < 5; q++) { const o = i * 6 + q; sideIdx.push(o, o + 6, o + 1, o + 1, o + 6, o + 7) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 2))
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4))
  g.setIndex(idx)
  g.computeVertexNormals()
  if (shared) {
    const m = new THREE.Mesh(g, shared.mat)
    m.receiveShadow = true
    root.add(m)
    addUnderside(side, col, sideIdx, root)
    return shared
  }
  const set = tiled(asphaltSet(), 2, 1)
  const wet = { value: def.look.wet ?? 0 }
  const dirtTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/biomes/${style.dirt ?? 'mud_cracked_dry_03'}_diff.jpg`)
  dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping
  dirtTex.colorSpace = THREE.SRGBColorSpace
  dirtTex.anisotropy = 8
  const mat = new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), color: 0xf0f0f4, roughness: 1, metalness: 0, envMapIntensity: 1 })
  mat.onBeforeCompile = (s) => {
    s.uniforms['tDirt'] = { value: dirtTex }
    s.uniforms['uWet'] = wet
    s.uniforms['uDash'] = { value: style.lines === 'highway' ? 1 : 0 }
    s.uniforms['uKerbA'] = { value: new THREE.Color(style.kerbColors?.[0] ?? 0xc22a22) }
    s.uniforms['uKerbB'] = { value: new THREE.Color(style.kerbColors?.[1] ?? 0xe8e8e4) }
    s.uniforms['uEdgeLine'] = { value: new THREE.Color(style.edgeLine ?? 0xdcdcd6) }
    s.uniforms['uGrime'] = { value: new THREE.Color(style.grime ?? 0x5a5044) }
    s.uniforms['uTone'] = { value: new THREE.Color(style.tone ?? 0xffffff) }
    s.uniforms['uSheen'] = { value: new THREE.Color(style.sheen ?? 0x000000) }
    s.uniforms['uLift'] = { value: (style.lift ?? 0) * 4 }
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRoad;\nattribute vec4 aInfo;\nvarying vec2 vRoad;\nvarying vec4 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;\nvInfo = aInfo;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROAD_GLSL}`)
      .replace('#include <map_fragment>', ROAD_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(gRough, 0.07, gWetMask);')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uSheen * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 5.0) * (0.05 + gWetMask * 0.42);`)
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * gNorm;'))
  }
  mat.customProgramCacheKey = () => 'kart-road'
  const m = new THREE.Mesh(g, mat)
  m.receiveShadow = true
  root.add(m)
  addUnderside(side, col, sideIdx, root)
  return { mat, wet }
}

/** The road's edges and underside. */
function addUnderside(side: number[], col: number[], sideIdx: number[], root: THREE.Group): void {
  const sg = new THREE.BufferGeometry()
  sg.setAttribute('position', new THREE.Float32BufferAttribute(side, 3))
  sg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  sg.setIndex(sideIdx)
  const flat = sg.toNonIndexed()
  flat.computeVertexNormals()
  const under = new THREE.Mesh(flat, surface('concrete', { double: true }))
  under.castShadow = true
  root.add(under)
}

/** A soft band of gravel where the road meets the ground. */
function buildVerge(def: TrackDef, c: Circuit, root: THREE.Group): void {
  const n = c.count, W = 3.4, last = c.closed ? n : n - 1
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  let along = 0
  for (let i = 0; i <= last; i++) {
    const k = i % n, half = c.widths[k]! / 2
    for (const s of [-1, 1]) {
      const a = edge(c, k, s * half, -0.015), b = edge(c, k, s * (half + W), -0.3)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
      uv.push(0, along, 1, along)
    }
    along += 2
    if (i < last && !c.raised[k] && !c.gap[k]) {
      const o = i * 4
      idx.push(o, o + 4, o + 1, o + 1, o + 4, o + 5, o + 2, o + 3, o + 6, o + 3, o + 7, o + 6)
    }
  }
  if (!idx.length) return
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  const mat = new THREE.MeshStandardMaterial({ color: def.road?.grime ?? 0x6a5f50, roughness: 1, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvV = uv;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_NOISE}\nvarying vec2 vV;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float vn = aFbm(vec2(vV.x * 3.0, vV.y * 0.22)) + aNoise(vec2(vV.x * 14.0, vV.y * 2.1)) * 0.3;
        diffuseColor.rgb *= 0.7 + aNoise(vec2(vV.x * 40.0, vV.y * 6.0)) * 0.6;
        diffuseColor.a = smoothstep(1.0, 0.1, vV.x + (vn - 0.65) * 1.1);`)
  }
  mat.customProgramCacheKey = () => 'kart-verge'
  const m = new THREE.Mesh(g, mat)
  m.receiveShadow = true
  m.renderOrder = 1
  root.add(m)
}

function buildRails(def: TrackDef, c: Circuit, root: THREE.Group): void {
  const style = def.rails ?? 'steel'
  if (style === 'none') return
  const posts = new Mesher()
  const beam = style === 'wood' ? 0x5a4029 : 0xb4b9c0
  for (const [flag, sign] of [[c.railL, -1], [c.railR, 1]] as const) {
    const pos: number[] = [], idx: number[] = []
    const rows = style === 'wood' ? [[0.5, 0.72], [1.02, 1.24]] : [[0.56, 0.98]]
    const n = c.count, last = c.closed ? n : n - 1
    for (const [lo, hi] of rows) {
      const base = pos.length / 3
      for (let i = 0; i <= last; i++) {
        const k = i % n, l = sign * (c.widths[k]! / 2 - 0.15)
        const a = edge(c, k, l, lo!), b = edge(c, k, l, hi!)
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
        if (i < last && flag[k] && flag[(k + 1) % n] && !c.gap[k]) { const o = base + i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2) }
      }
    }
    for (let k = 0; k < n; k += style === 'wood' ? 3 : 2) {
      if (!flag[k] || c.gap[k]) continue
      const l = sign * (c.widths[k]! / 2 - 0.08), e = edge(c, k, l, 0)
      if (style === 'wood') posts.box(0.24, 1.5, 0.24, e.x, e.y + 0.7, e.z, 0x4a3422)
      else posts.box(0.11, 1.08, 0.2, e.x, e.y + 0.5, e.z, 0x6f747b, Math.atan2(c.tangents[k]!.x, c.tangents[k]!.z))
    }
    if (!idx.length) continue
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    const mat = style === 'wood'
      ? new THREE.MeshStandardMaterial({ color: beam, roughness: 0.92, side: THREE.DoubleSide })
      : new THREE.MeshStandardMaterial({ color: beam, metalness: 0.75, roughness: 0.34, side: THREE.DoubleSide })
    root.add(new THREE.Mesh(g, mat))
  }
  if (!posts.empty) root.add(new THREE.Mesh(posts.build(), surface(style === 'wood' ? 'wood' : 'metal')))
}

/** Boost strips: animated chevrons set into the road. */
function buildPads(c: Circuit, root: THREE.Group): void {
  const pos: number[] = [], uv: number[] = [], idx: number[] = []
  let run = 0
  for (let i = 0; i < c.count; i++) {
    if (!c.pad[i]) { run = 0; continue }
    const half = 3.2
    const lat = c.padLat[i]!
    const a = edge(c, i, lat - half, 0.09), b = edge(c, i, lat + half, 0.09)
    const j = (i + 1) % c.count
    const a2 = edge(c, j, lat - half, 0.09), b2 = edge(c, j, lat + half, 0.09)
    const o = pos.length / 3
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, a2.x, a2.y, a2.z, b2.x, b2.y, b2.z)
    uv.push(0, run, 1, run, 0, run + 1, 1, run + 1)
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2)
    run++
  }
  if (!idx.length) return
  const tex = canvasTexture(128, 128, (g, W, H) => {
    g.fillStyle = '#0a2030'
    g.fillRect(0, 0, W, H)
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.moveTo(0, H * 0.75); g.lineTo(W / 2, H * 0.2); g.lineTo(W, H * 0.75); g.lineTo(W, H); g.lineTo(W / 2, H * 0.45); g.lineTo(0, H); g.closePath()
    g.fill()
  })
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1, 0.5)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.5, 2.2, 2.6), toneMapped: false, side: THREE.DoubleSide }))
  m.name = 'pads'
  root.add(m)
}

function buildSupports(c: Circuit, w: World, root: THREE.Group): void {
  const m = new Mesher()
  const STEP = 22
  for (let i = 0; i < c.count; i += STEP) {
    if (!c.raised[i] || c.gap[i] || c.tunnel[i]) continue
    const p = c.samples[i]!, base = Math.max(w.terrainAt(p.x, p.z), w.sea - 4), h = p.y - base - 1.5
    if (h < 3) continue
    const yaw = Math.atan2(c.tangents[i]!.x, c.tangents[i]!.z), width = c.widths[i]!
    const tone = 0x96989c
    // tapering column under a hammerhead that carries the deck
    m.add(new THREE.BoxGeometry(width * 0.34, h, 3.2), trs(p.x, base + h / 2, p.z, yaw), tone)
    m.add(new THREE.BoxGeometry(width * 0.5, h * 0.12, 4.2), trs(p.x, base + h * 0.06, p.z, yaw), 0x7f8186)
    m.add(new THREE.CylinderGeometry(width * 0.52, width * 0.2, 2.4, 4, 1), trs(p.x, p.y - 2.6, p.z, yaw + Math.PI / 4, new THREE.Vector3(1, 1, 0.26)), tone)
    w.addBox(p.x, p.z, width * 0.2, 1.7, yaw, p.y - 3)
  }
  if (m.empty) return
  const mesh = new THREE.Mesh(m.build(), surface('concrete'))
  mesh.castShadow = true
  mesh.receiveShadow = true
  root.add(mesh)
}

function buildStart(c: Circuit, root: THREE.Group): void {
  const tex = canvasTexture(512, 64, (g, w, h) => {
    const s = h / 4
    for (let y = 0; y < 4; y++) for (let x = 0; x < w / s; x++) {
      g.fillStyle = (x + y) % 2 ? '#15161a' : '#e6e6e4'
      g.fillRect(x * s, y * s, s, s)
    }
  })
  const p = c.samples[0]!, t = c.tangents[0]!
  const line = new THREE.Mesh(new THREE.PlaneGeometry(c.widths[0]!, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }))
  line.position.set(p.x, p.y + 0.07, p.z)
  line.rotation.set(-Math.PI / 2, 0, Math.atan2(-t.x, -t.z))
  root.add(line)
  // painted grid boxes
  const mat = new THREE.MeshBasicMaterial({ color: 0xd4d4d0, transparent: true, opacity: 0.7 })
  for (let s = 0; s < 6; s++) {
    const spot = c.gridSpot(s), i = spot.i, r = c.rights[i]!, tt = c.tangents[i]!
    const yaw = Math.atan2(-tt.x, -tt.z)
    const box = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.2), mat)
    box.position.set(spot.pos.x + tt.x * 2.6, spot.pos.y + 0.07, spot.pos.z + tt.z * 2.6)
    box.rotation.set(-Math.PI / 2, 0, yaw)
    root.add(box)
    for (const e of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 1.8), mat)
      side.position.set(spot.pos.x + tt.x * 1.8 + r.x * e * 1.6, spot.pos.y + 0.07, spot.pos.z + tt.z * 1.8 + r.z * e * 1.6)
      side.rotation.set(-Math.PI / 2, 0, yaw)
      root.add(side)
    }
  }
}

function buildGround(def: TrackDef, w: World, root: THREE.Group): void {
  if (!def.terrain) return
  if (def.far !== undefined) {
    const { nx, nz, x0, z0, cell } = w.gridSize
    const plain = new THREE.Mesh(new THREE.CircleGeometry(9000, 40), new THREE.MeshStandardMaterial({ color: def.far, roughness: 1 }))
    plain.rotation.x = -Math.PI / 2
    plain.position.set(x0 + nx * cell / 2, def.farY ?? -6, z0 + nz * cell / 2)
    root.add(plain)
  }
  const { nx, nz, x0, z0, cell } = w.gridSize
  const CH = 64
  const mat = terrainMaterial(def.terrain)
  const col = new THREE.Color()
  const mix = [1, 0, 0, 0]
  const hidden = def.groundBelow ?? -1e9
  for (let cj = 0; cj < nz - 1; cj += CH) for (let ci = 0; ci < nx - 1; ci += CH) {
    const ni = Math.min(CH, nx - 1 - ci) + 1, nj = Math.min(CH, nz - 1 - cj) + 1
    const pos = new Float32Array(ni * nj * 3), colr = new Float32Array(ni * nj * 3), uv = new Float32Array(ni * nj * 2), spl = new Float32Array(ni * nj * 4)
    let wet = true
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const gi = ci + i, gj = cj + j, k = j * ni + i
      const x = x0 + gi * cell, z = z0 + gj * cell, h = w.heights[gj * nx + gi]!
      if (h > w.sea - 12 && h > hidden) wet = false
      pos.set([x, h, z], k * 3)
      uv.set([x / 7, z / 7], k * 2)
      const hx = w.heights[gj * nx + Math.min(gi + 1, nx - 1)]! - h, hz = w.heights[Math.min(gj + 1, nz - 1) * nx + gi]! - h
      const slope = Math.hypot(hx, hz) / cell
      mix[0] = 1; mix[1] = mix[2] = mix[3] = 0
      col.setRGB(1, 1, 1)
      def.splat?.(x, z, h, slope, w.roadDist[gj * nx + gi]!, mix, col)
      colr.set([col.r, col.g, col.b], k * 3)
      spl.set(mix, k * 4)
    }
    if (wet) continue // nothing here would be seen
    const idx: number[] = []
    for (let j = 0; j < nj - 1; j++) for (let i = 0; i < ni - 1; i++) {
      const a = j * ni + i
      const h0 = pos[a * 3 + 1]!, h1 = pos[(a + 1) * 3 + 1]!, h2 = pos[(a + ni) * 3 + 1]!, h3 = pos[(a + ni + 1) * 3 + 1]!
      if (Math.max(h0, h1, h2, h3) <= hidden) continue // open air under a floating island
      idx.push(a, a + ni, a + 1, a + 1, a + ni, a + ni + 1)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setAttribute('splat', new THREE.BufferAttribute(spl, 4))
    g.setIndex(idx)
    g.computeVertexNormals()
    const m = new THREE.Mesh(g, mat)
    m.receiveShadow = true
    root.add(m)
  }
}
