import * as THREE from 'three'
import {
  TRACK_CONTROL_POINTS,
  FLIGHT_ZONES,
  SPACE_ZONES,
  LOOPS,
  ROLLS,
  GROUND_ZONES,
  LANDMARKS,
  type ZoneName,
} from './trackData'
import { asphaltSet, tiled, applyTextureOverrides } from './Textures'
import { cornerStrength } from './RoadDetails'
import { CAUSTIC_GLSL } from './Underwater'

export interface NearestResult {
  index: number
  distance: number   // horizontal distance from centerline (m)
  point: THREE.Vector3
}

/**
 * The full four-biome loop, built from external track data (trackData.ts).
 * Each sample carries a zone label derived from its control-point span —
 * the single source of truth for road gaps, neon line colors, scenery
 * dressing and the flight autopilot.
 *
 * The two `flight` zones are real gaps: no road ribbon or edge lines are
 * built there, so the jump visibly has nothing under it.
 */
export class Track {
  public readonly group: THREE.Group
  public readonly samples: THREE.Vector3[]
  public readonly tangents: THREE.Vector3[]
  public readonly zones: ZoneName[]
  public readonly width = 21
  public readonly spawnPosition: THREE.Vector3
  public readonly spawnHeading: number
  public readonly length: number

  /** Road "up" per sample: straight up, except round the vertical loop. */
  public readonly ups: THREE.Vector3[]

  constructor() {
    this.group = new THREE.Group()

    const controlPoints = TRACK_CONTROL_POINTS.map(
      (cp) => new THREE.Vector3(cp.x, cp.y, cp.z)
    )
    const curve = new THREE.CatmullRomCurve3(controlPoints, true, 'centripetal')
    // ~56 samples per control-point span (spans share samples evenly)
    this.samples = curve.getPoints(controlPoints.length * 56)
    this.samples.pop() // closed curve repeats first point

    const n = this.samples.length
    const cpCount = TRACK_CONTROL_POINTS.length
    this.zones = this.samples.map((_, i) => {
      const spanIdx = Math.min(Math.floor((i / n) * cpCount), cpCount - 1)
      return TRACK_CONTROL_POINTS[spanIdx]!.zone
    })
    // Land sections never dip below ground level (the curve undershoots a
    // little near the finish line, which buried the car under the grass)
    this.samples.forEach((p, i) => {
      const z = this.zones[i]
      if (GROUND_ZONES.has(z!) && p.y < 0.02) p.y = 0.02
    })

    this.tangents = this.samples.map((p, i) => {
      const next = this.samples[(i + 1) % n]!
      return next.clone().sub(p).normalize()
    })

    // Road normal: up everywhere except in the loop, where it points at the
    // loop's axis (perpendicular to the direction of travel)
    this.ups = this.samples.map((p, i) => {
      if (this.zones[i] === 'roll') return this.rollUp(p)
      if (this.zones[i] !== 'loop') return new THREE.Vector3(0, 1, 0)
      let best: THREE.Vector3 | null = null
      let bestD = Infinity
      let base = 0
      for (const L of LOOPS) {
        const lat = new THREE.Vector3(L.lateral[0], 0, L.lateral[1])
        const c = new THREE.Vector3(...L.center)
        const a = p.clone().sub(c).dot(lat)
        const axis = c.addScaledVector(lat, a)
        const d = axis.distanceTo(p)
        if (d < bestD) { bestD = d; best = axis.sub(p); base = L.center[1] - L.radius }
      }
      const t = this.tangents[i]!
      const nrm = best!.addScaledVector(t, -best!.dot(t))
      // Run-in / run-out near the ground: blend toward straight up
      const k = THREE.MathUtils.clamp((p.y - base - 0.2) / 2, 0, 1)
      return nrm.normalize().lerp(new THREE.Vector3(0, 1, 0), 1 - k).normalize()
    })

    let len = 0
    for (let i = 0; i < n; i++) {
      len += this.samples[i]!.distanceTo(this.samples[(i + 1) % n]!)
    }
    this.length = len

    this.spawnPosition = this.samples[0]!.clone()
    const t0 = this.tangents[0]!
    this.spawnHeading = Math.atan2(-t0.x, -t0.z)

    this.buildRoad()
    this.buildLoopRoad()
    this.buildNeonEdgeLines()
    this.buildStartLine()
  }

  /** Barrel roll: up points from the deck at the roll's centre line. */
  private rollUp(p: THREE.Vector3): THREE.Vector3 {
    let best = ROLLS[0]!
    let bestD = Infinity
    for (const R of ROLLS) {
      const d = Math.hypot(p.x - R.start[0], p.z - R.start[2])
      if (d < bestD) { bestD = d; best = R }
    }
    const s = (p.x - best.start[0]) * best.dir[0] + (p.z - best.start[2]) * best.dir[1]
    const axis = new THREE.Vector3(best.start[0] + best.dir[0] * s, best.start[1] + best.heart, best.start[2] + best.dir[1] * s)
    const u = axis.sub(p)
    return u.lengthSq() > 1e-4 ? u.normalize() : new THREE.Vector3(0, 1, 0)
  }

  zoneOfSample(i: number): ZoneName {
    return this.zones[((i % this.zones.length) + this.zones.length) % this.zones.length]!
  }

  /** No regular road here: flight jumps, and the loop (built on its own). */
  isGap(i: number): boolean {
    const z = this.zoneOfSample(i)
    return FLIGHT_ZONES.has(z) || z === 'loop' || z === 'roll'
  }

  /** Carried round by the ride autopilot: vertical loops and barrel rolls. */
  isLoop(i: number): boolean {
    const z = this.zoneOfSample(i)
    return z === 'loop' || z === 'roll'
  }

  /** Jungle gorge: a timber plank bridge. */
  isPlankDeck(i: number): boolean {
    if (this.zoneOfSample(i) !== 'jungle') return false
    const p = this.samples[i]!, b = LANDMARKS.jungleBridge
    return Math.hypot(p.x - b.x, p.z - b.z) < b.half
  }

  /** Sky islands: the road is a lit glass deck, not asphalt. */
  isGlassDeck(i: number): boolean {
    const z = this.zoneOfSample(i)
    return z === 'sky' || z === 'roll'
  }

  /**
   * Maximal contiguous runs of non-gap samples, wrap-aware. Each run is a
   * list of consecutive sample indices; used to build open road ribbons.
   */
  private roadRuns(skip: (i: number) => boolean = (i) => this.isGap(i) || this.isGlassDeck(i) || this.isPlankDeck(i)): number[][] {
    const n = this.samples.length
    const runs: number[][] = []
    // Find a gap sample to anchor the walk so wraparound runs merge correctly
    let start = 0
    while (start < n && !skip(start)) start++
    if (start === n) {
      // no gaps at all — single closed run
      return [Array.from({ length: n + 1 }, (_, i) => i % n)]
    }
    let current: number[] | null = null
    for (let o = 0; o <= n; o++) {
      const i = (start + o) % n
      if (skip(i)) {
        if (current && current.length > 1) runs.push(current)
        current = null
      } else {
        if (!current) current = []
        current.push(i)
      }
    }
    if (current && current.length > 1) runs.push(current)
    return runs
  }

  /**
   * Per-sample road dusting colour (rgb + amount) and street wetness by
   * biome, smoothed over ~60 samples so the change fades in, not snaps.
   */
  private surfaceTints(): { tint: [number, number, number, number][]; wet: number[] } {
    const TINTS: Partial<Record<ZoneName, [number, number, number, number]>> = {
      volcano: [0.16, 0.15, 0.14, 0.55],
      desert: [0.8, 0.64, 0.43, 0.6],
      saltflat: [0.92, 0.91, 0.88, 0.5],
      snow: [0.93, 0.95, 0.99, 0.75],
      jungle: [0.27, 0.21, 0.13, 0.45],
    }
    const n = this.samples.length
    const lake = LANDMARKS.iceLake
    const raw: [number, number, number, number][] = this.samples.map((p, i) =>
      this.zones[i] === 'snow' && Math.hypot(p.x - lake.x, p.z - lake.z) < lake.r ? [0.5, 0.72, 0.88, 0.95] : TINTS[this.zones[i]!] ?? [0, 0, 0, 0])
    // the night city's streets are wet; dry again out of the tunnel (x < -95)
    const rawWet = this.samples.map((p, i) => (this.zones[i] === 'city' && p.x > -95 ? 1 : 0))
    const W = 30
    const tint: [number, number, number, number][] = []
    const wet: number[] = []
    for (let i = 0; i < n; i++) {
      let r = 0, g = 0, b = 0, a = 0, colW = 0, w = 0
      for (let o = -W; o <= W; o++) {
        const k = (i + o + n) % n
        const t = raw[k]!
        a += t[3]
        if (t[3] > 0) { r += t[0] * t[3]; g += t[1] * t[3]; b += t[2] * t[3]; colW += t[3] }
        w += rawWet[k]!
      }
      tint.push(colW > 0 ? [r / colW, g / colW, b / colW, a / (2 * W + 1)] : [0, 0, 0, 0])
      wet.push(w / (2 * W + 1))
    }
    return { tint, wet }
  }

  // ── Road surface ─────────────────────────────────────────────────────
  public roadMaterial: THREE.MeshStandardMaterial | null = null
  private roadShader: { uniforms: Record<string, THREE.IUniform> } | null = null

  /**
   * Lit PBR asphalt (color + normal + roughness maps; receives shadows and
   * reflects the sky) with worn painted lane markings drawn in the shader.
   * uv.x runs 0→1 across the road, uv.y is metres along it / 8.
   */
  private buildRoad(): void {
    const half = this.width / 2
    const up = new THREE.Vector3(0, 1, 0)

    // ~4 m asphalt tiles across the 21 m road
    const set = tiled(asphaltSet(), this.width / 4, 8 / 4)
    const mat = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: set.roughnessMap,
      roughness: 1,
      metalness: 0,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 }
      shader.uniforms['uCaustic'] = { value: 0 }
      shader.uniforms['uWet'] = { value: this.wetness }
      this.roadShader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCorner;\nattribute vec4 aTint;\nattribute float aWetZone;\nvarying vec2 vRoadUv;\nvarying float vCorner;\nvarying vec4 vTint;\nvarying float vWetZone;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoadUv = uv;\nvCorner = aCorner;\nvTint = aTint;\nvWetZone = aWetZone;')
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          varying vec2 vRoadUv;
          varying float vCorner;
          varying vec4 vTint;
          varying float vWetZone;
          float roadWet = 0.0;
          float roadCover = 0.0;
          float roadIce = 0.0;
          uniform float uTime;
          uniform float uCaustic;
          uniform float uWet;
          float roadPaint = 0.0;
          float roadPuddle = 0.0;
          ${CAUSTIC_GLSL}
          float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float rn(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(rh(i), rh(i + vec2(1.0, 0.0)), f.x), mix(rh(i + vec2(0.0, 1.0)), rh(i + vec2(1.0, 1.0)), f.x), f.y);
          }`
        )
        .replace(
          '#include <map_fragment>',
          /* glsl */ `#include <map_fragment>
          {
            float across = vRoadUv.x;
            float along = vRoadUv.y * 8.0; // metres
            // Large-scale patching variation (breaks up visible tiling)
            float macro = texture2D(map, vRoadUv * vec2(0.37, 0.045)).r;
            diffuseColor.rgb *= 0.7 + macro * 1.4;
            // Slightly darker, polished tyre tracks in each lane
            float lanePos = fract(across * 4.0);
            float tyre = smoothstep(0.08, 0.0, abs(lanePos - 0.3)) + smoothstep(0.08, 0.0, abs(lanePos - 0.7));
            diffuseColor.rgb *= 1.0 - tyre * 0.12;
            // Lane dividers: dashed white at 1/4, 1/2, 3/4 (3 m dash, 9 m gap)
            float laneLine = 0.0;
            float w = 0.15 / 21.0;
            for (int k = 1; k <= 3; k++) {
              float d = abs(across - float(k) * 0.25);
              laneLine = max(laneLine, 1.0 - smoothstep(w * 0.7, w, d));
            }
            // Old skid marks through the corners: pairs of dark tyre streaks
            // that wander across the lanes in broken arcs
            if (vCorner > 0.3) {
              float skid = 0.0;
              for (int j = 0; j < 3; j++) {
                float fj = float(j);
                float c = 0.3 + fj * 0.18 + 0.06 * sin(along * 0.03 + fj * 2.1);
                float w = 0.012;
                float l1 = 1.0 - smoothstep(w * 0.5, w, abs(across - c));
                float l2 = 1.0 - smoothstep(w * 0.5, w, abs(across - c - 0.075));
                float ph = fract(along / 70.0 + fj * 0.37);
                float seg = smoothstep(0.2, 0.4, ph) * (1.0 - smoothstep(0.75, 0.95, ph));
                skid = max(skid, max(l1, l2) * seg);
              }
              skid *= smoothstep(0.3, 0.9, vCorner) * (0.5 + 0.5 * macro);
              diffuseColor.rgb *= 1.0 - skid * 0.55;
            }
            float dash = step(fract(along / 12.0), 0.25);
            // Worn paint lets some asphalt show through
            roadPaint = laneLine * dash * (0.7 + 0.3 * macro);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.75, 0.71), roadPaint);

            // Biome dusting: snow / sand / ash / salt / mud drifts in from
            // the verges and lies in patches, worn away in the tyre tracks
            if (vTint.a > 0.01) {
              vec2 dq = vec2(across * 21.0, along);
              float dn = rn(dq * 0.11) * 0.6 + rn(dq * 0.37 + 5.3) * 0.3 + rn(dq * 1.7 + 1.1) * 0.1;
              float edge = smoothstep(0.3, 0.49, abs(across - 0.5));
              roadCover = clamp(edge * (0.7 + dn * 0.6) + smoothstep(0.6, 0.78, dn) * 0.9 - tyre * 0.6, 0.0, 1.0) * vTint.a;
              // the ice road: a glassy sheet over the whole width
              roadIce = smoothstep(0.55, 0.94, vTint.a);
              roadCover = max(roadCover, roadIce * (0.42 + dn * 0.3));
              diffuseColor.rgb = mix(diffuseColor.rgb, vTint.rgb * (0.85 + dn * 0.3), roadCover);
            }
            roadWet = max(uWet, vWetZone);

            // Rain: wet asphalt is darker and glossy; puddles collect in
            // the tyre ruts and low patches and turn into mirrors
            if (roadWet > 0.01) {
              // Isotropic noise in metres, rotated off the road grid, so
              // puddles come out as rounded organic patches
              vec2 pq = mat2(0.8, -0.6, 0.6, 0.8) * vec2(across * 21.0, along) * 0.17;
              float pn = rn(pq) * 0.55 + rn(pq * 2.3 + 3.1) * 0.3 + rn(pq * 5.1 + 7.7) * 0.15;
              pn += tyre * 0.12;
              roadPuddle = smoothstep(0.64, 0.71, pn) * roadWet;
              diffuseColor.rgb *= mix(1.0, 0.45, roadWet);
              diffuseColor.rgb *= 1.0 - roadPuddle * 0.35;
            }
          }`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.6, roadPaint);
          roughnessFactor = mix(roughnessFactor, mix(0.3, 0.02, roadPuddle), roadWet);
          roughnessFactor = mix(roughnessFactor, mix(0.95, 0.06, roadIce), roadCover);`
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `#include <normal_fragment_maps>
          // Puddles are flat water: drop the asphalt bumps, add rain ripples
          if (roadPuddle > 0.001) {
            float r1 = sin(length(fract(vRoadUv * vec2(40.0, 8.0)) - 0.5) * 60.0 - uTime * 9.0);
            vec3 ripple = vec3(r1 * 0.02, r1 * 0.02, 0.0);
            normal = normalize(mix(normal, nonPerturbedNormal + ripple, roadPuddle));
          }`
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          // Underwater caustic shimmer — overlapping traveling sine cells
          if (uCaustic > 0.01) {
            // Same caustic light network as the seabed, in road metres
            float caustic = caustics(vec2(vRoadUv.x * 21.0, vRoadUv.y * 8.0) * 0.33, uTime);
            totalEmissiveRadiance += vec3(0.5, 0.9, 0.85) * caustic * 0.45 * uCaustic;
          }`
        )
    }
    applyTextureOverrides(mat, 'asphalt')
    this.roadMaterial = mat

    const corner = cornerStrength(this)
    const { tint, wet } = this.surfaceTints()
    for (const run of this.roadRuns()) {
      const tints: number[] = []
      const wets: number[] = []
      const corners: number[] = []
      const positions: number[] = []
      const uvs: number[] = []
      const indices: number[] = []
      let accumulated = 0
      let vi = 0

      for (let k = 0; k < run.length; k++) {
        const idx = run[k]!
        const p = this.samples[idx]!
        const tangent = this.tangents[idx]!
        const right = new THREE.Vector3().crossVectors(tangent, up).normalize()

        const left = p.clone().addScaledVector(right, -half)
        const rightPt = p.clone().addScaledVector(right, half)
        positions.push(left.x, p.y + 0.02, left.z, rightPt.x, p.y + 0.02, rightPt.z)

        if (k > 0) accumulated += p.distanceTo(this.samples[run[k - 1]!]!)
        const v = accumulated / 8
        uvs.push(0, v, 1, v)
        corners.push(corner[idx]!, corner[idx]!)
        const tt = tint[idx]!
        tints.push(...tt, ...tt)
        wets.push(wet[idx]!, wet[idx]!)

        if (k < run.length - 1) {
          indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2)
        }
        vi += 2
      }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corners, 1))
      geo.setAttribute('aTint', new THREE.Float32BufferAttribute(tints, 4))
      geo.setAttribute('aWetZone', new THREE.Float32BufferAttribute(wets, 1))
      geo.setIndex(indices)
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, mat)
      mesh.receiveShadow = true
      this.group.add(mesh)
    }
  }

  /**
   * The vertical loop: road deck built with each sample's own up vector
   * (so it rolls round the circle), a steel underside, safety walls with
   * white edge lines, and a steel support frame either side.
   */
  private buildLoopRoad(): void {
    const n = this.samples.length
    if (!this.roadMaterial) return
    // Each loop is its own run of consecutive samples
    const runs: number[][] = []
    for (let i = 0; i < n; i++) {
      if (!this.isLoop(i)) continue
      const last = runs[runs.length - 1]
      if (last && last[last.length - 1] === i - 1) last.push(i)
      else runs.push([i])
    }
    const steel = new THREE.MeshStandardMaterial({ color: 0x6f757b, metalness: 0.75, roughness: 0.45, side: THREE.DoubleSide })
    for (const run of runs) this.buildLoopRun(run, steel, this.zoneOfSample(run[0]!) === 'roll' ? 'glass' : 'asphalt')
    this.buildLoopSupports(steel)
    // Sky islands: the whole highway is a glass deck
    for (const run of this.roadRuns((i) => this.isGap(i) || !this.isGlassDeck(i))) this.buildLoopRun(run, steel, 'glass')
    for (const run of this.roadRuns((i) => !this.isPlankDeck(i))) this.buildLoopRun(run, steel, 'planks')
  }

  private glassDeck: THREE.MeshPhysicalMaterial | null = null
  /** Breakable panels: u0, u1, v0, v1 on the deck, and state (0 whole, 0–1 warning, 2 gone). */
  readonly deckHoles = { rect: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -1, -1)), state: { value: new Float32Array(6) } }
  /** Deck texture row (v) at each glass sample. */
  readonly deckV = new Map<number, number>()
  private ledMat: THREE.MeshStandardMaterial | null = null

  /** Frosted glass panels with steel seams and cyan LED lane dashes. */
  private glassDeckMaterial(): THREE.MeshPhysicalMaterial {
    if (this.glassDeck) return this.glassDeck
    const W = 512, H = 256
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')!
    const grad = g.createLinearGradient(0, 0, W, 0)
    grad.addColorStop(0, '#4f7186')
    grad.addColorStop(0.5, '#7aa2b8')
    grad.addColorStop(1, '#4f7186')
    g.fillStyle = grad
    g.fillRect(0, 0, W, H)
    // frosted grain
    for (let k = 0; k < 9000; k++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`
      g.fillRect(Math.random() * W, Math.random() * H, 2, 2)
    }
    // steel panel seams: 6 panels across, one joint per 8 m
    g.fillStyle = '#4c5a63'
    for (let k = 0; k <= 6; k++) g.fillRect((k / 6) * W - 2, 0, 4, H)
    g.fillRect(0, 0, W, 5)
    const em = document.createElement('canvas')
    em.width = W
    em.height = H
    const e = em.getContext('2d')!
    e.fillStyle = '#000'
    e.fillRect(0, 0, W, H)
    e.fillStyle = '#5ff2ff'
    // lane dashes (3 m of every 8 m) and continuous edge strips
    for (const u of [0.25, 0.5, 0.75]) e.fillRect(u * W - 3, 0, 6, H * 0.375)
    for (const u of [0.035, 0.965]) e.fillRect(u * W - 4, 0, 8, H)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 8
    const etex = new THREE.CanvasTexture(em)
    etex.colorSpace = THREE.SRGBColorSpace
    etex.wrapT = THREE.RepeatWrapping
    etex.anisotropy = 8
    this.glassDeck = new THREE.MeshPhysicalMaterial({
      map: tex,
      emissiveMap: etex,
      emissive: 0xffffff,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.7,
      roughness: 0.32,
      metalness: 0.1,
      clearcoat: 0.3,
      clearcoatRoughness: 0.2,
      specularIntensity: 0.45,
      envMapIntensity: 0.6,
      side: THREE.DoubleSide,
    })
    this.glassDeck.onBeforeCompile = (sh) => {
      sh.uniforms['uHole'] = { value: this.deckHoles.rect }
      sh.uniforms['uHoleS'] = this.deckHoles.state
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDeck;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDeck = uv;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vDeck;\nuniform vec4 uHole[6];\nuniform float uHoleS[6];\nfloat deckWarn = 0.0;')
        .replace('#include <map_fragment>', `#include <map_fragment>
        for (int k = 0; k < 6; k++) {
          vec4 h = uHole[k];
          if (vDeck.x > h.x && vDeck.x < h.y && vDeck.y > h.z && vDeck.y < h.w) {
            if (uHoleS[k] > 1.5) discard;
            deckWarn = max(deckWarn, uHoleS[k]);
          }
        }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3(2.4, 0.18, 0.08) * deckWarn;`)
    }
    return this.glassDeck
  }

  private plankMaterial(): THREE.MeshStandardMaterial {
    const W = 256, H = 512
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')!
    // weathered planks laid across the deck, ~0.3 m wide (24 per 8 m)
    const rows = 24
    for (let k = 0; k < rows; k++) {
      const y0 = (k / rows) * H
      const base = 70 + Math.random() * 45
      g.fillStyle = `rgb(${base + 30},${base + 8},${base - 22})`
      g.fillRect(0, y0, W, H / rows)
      for (let q = 0; q < 40; q++) {
        g.fillStyle = `rgba(${30 + Math.random() * 40},${20 + Math.random() * 25},10,${0.15 + Math.random() * 0.2})`
        g.fillRect(0, y0 + Math.random() * (H / rows), W, 1)
      }
      g.fillStyle = 'rgba(20,12,6,0.85)'
      g.fillRect(0, y0, W, 2)
      // iron nails near each stringer
      g.fillStyle = '#2b2b2b'
      for (const u of [0.12, 0.5, 0.88]) g.fillRect(u * W - 2, y0 + H / rows / 2 - 2, 4, 4)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 8
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide })
  }

  private buildLoopRun(idx: number[], steel: THREE.Material, style: 'asphalt' | 'glass' | 'planks' = 'asphalt'): void {
    const glass = style === 'glass'
    const n = this.samples.length
    // one sample of overlap with the normal road at each end
    idx = [(idx[0]! - 1 + n) % n, ...idx, (idx[idx.length - 1]! + 1) % n]
    const half = this.width / 2
    const frame = idx.map((i) => {
      const t = this.tangents[i]!, u = this.ups[i]!
      return { p: this.samples[i]!, u, r: new THREE.Vector3().crossVectors(t, u).normalize() }
    })

    // Generic strip: rows of (across offset, offset along up)
    const strip = (rows: [number, number][], mat: THREE.Material, withRoadAttrs = false): THREE.Mesh => {
      const pos: number[] = [], uv: number[] = [], corner: number[] = [], index: number[] = []
      let along = 0
      frame.forEach((f, k) => {
        if (k > 0) along += f.p.distanceTo(frame[k - 1]!.p)
        for (const [a, h] of rows) {
          const v = f.p.clone().addScaledVector(f.r, a).addScaledVector(f.u, h)
          pos.push(v.x, v.y, v.z)
          uv.push((a + half) / this.width, along / 8)
          corner.push(0)
        }
        if (k > 0) {
          const R = rows.length, b = k * R, a0 = b - R
          for (let j = 0; j < R - 1; j++) index.push(a0 + j, a0 + j + 1, b + j, a0 + j + 1, b + j + 1, b + j)
        }
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      if (withRoadAttrs) {
        g.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 1))
        g.setAttribute('aTint', new THREE.Float32BufferAttribute(new Float32Array(corner.length * 4), 4))
        g.setAttribute('aWetZone', new THREE.Float32BufferAttribute(new Float32Array(corner.length), 1))
      }
      g.setIndex(index)
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, mat)
      m.castShadow = true
      m.receiveShadow = true
      this.group.add(m)
      return m
    }

    if (style === 'planks') {
      strip([[-half, 0.02], [half, 0.02]], this.plankMaterial())
      const wood = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.9 })
      // side stringers (the rope rails and posts come from the jungle scenery)
      for (const s of [-1, 1]) strip([[s * half, 0.1], [s * (half + 0.45), 0.1], [s * (half + 0.45), -0.8], [s * half, -0.8]], wood)
      strip([[-half, -0.05], [-half, -0.4], [half, -0.4], [half, -0.05]], wood)
      return
    }
    if (glass) {
      // Glass deck on a slim steel edge frame, glass parapets with an LED rail
      let al = 0
      frame.forEach((f, k) => { if (k > 0) al += f.p.distanceTo(frame[k - 1]!.p); this.deckV.set(idx[k]!, al / 8) })
      const deck = strip([[-half, 0.02], [half, 0.02]], this.glassDeckMaterial())
      deck.castShadow = false
      deck.renderOrder = 2
      for (const s of [-1, 1]) {
        strip([[s * half, 0.05], [s * (half + 0.5), 0.05], [s * (half + 0.5), -0.6], [s * half, -0.6]], steel)
      }
      const pane = strip(
        [[-half - 0.3, 0], [-half - 0.3, 1.25]],
        new THREE.MeshPhysicalMaterial({ color: 0xcfefff, transparent: true, opacity: 0.22, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
      )
      pane.castShadow = false
      const pane2 = strip(
        [[half + 0.3, 0], [half + 0.3, 1.25]],
        pane.material as THREE.Material,
      )
      pane2.castShadow = false
      this.ledMat ??= new THREE.MeshStandardMaterial({ color: 0x9ff8ff, emissive: 0x3fe8ff, emissiveIntensity: 2.4 })
      for (const s of [-1, 1]) strip([[s * (half + 0.12), 1.25], [s * (half + 0.48), 1.25]], this.ledMat)
      return
    }
    // Asphalt deck (same road shader, so lane markings carry on)
    strip([[-half, 0.02], [half, 0.02]], this.roadMaterial!, true)
    // Steel underside + deck edge
    strip([[-half - 0.4, 0.02], [-half - 0.4, -0.7], [half + 0.4, -0.7], [half + 0.4, 0.02]], steel)
    // Safety walls with a white edge line just inside each
    const wall = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide })
    for (const s of [-1, 1]) {
      strip([[s * half, 0], [s * (half + 0.15), 1.1], [s * (half + 0.4), 1.1], [s * (half + 0.4), 0]], wall)
    }
    const paint = new THREE.MeshStandardMaterial({ color: 0xd8d6cc, roughness: 0.6 })
    for (const s of [-1, 1]) {
      const c = s * this.width * 0.46
      strip([[c - 0.19, 0.07], [c + 0.19, 0.07]], paint)
    }

    // Under the sea: the loop runs inside a glass half-tube with steel ribs
    const avgY = idx.reduce((a, i) => a + this.samples[i]!.y, 0) / idx.length
    if (avgY < -2) {
      const R = this.width * 0.62
      const rows: [number, number][] = []
      for (let k = 0; k <= 18; k++) {
        const a = (k / 18) * Math.PI
        rows.push([Math.cos(a) * R, Math.sin(a) * R])
      }
      const glass = strip(rows, new THREE.MeshPhysicalMaterial({
        color: 0xd8f4f6, transparent: true, opacity: 0.1, roughness: 0.04, metalness: 0,
        envMapIntensity: 0.8, side: THREE.DoubleSide, depthWrite: false,
      }))
      glass.castShadow = false
      glass.renderOrder = 3
      const ribGeo = new THREE.TorusGeometry(R, 0.16, 6, 28, Math.PI)
      const mats: THREE.Matrix4[] = []
      for (let k = 0; k < frame.length; k += 14) {
        const f = frame[k]!
        const t = this.tangents[idx[k]!]!
        mats.push(new THREE.Matrix4().makeBasis(f.r, f.u, t).setPosition(f.p))
      }
      const ribs = new THREE.InstancedMesh(ribGeo, steel, mats.length)
      mats.forEach((m, k) => ribs.setMatrixAt(k, m))
      ribs.computeBoundingSphere()
      this.group.add(ribs)
    }
  }

  /** Support frame: a steel A-frame each side of every loop. */
  private buildLoopSupports(steel: THREE.Material): void {
    const half = this.width / 2
    for (const L of LOOPS) {
      const c = new THREE.Vector3(...L.center)
      const lat = new THREE.Vector3(L.lateral[0], 0, L.lateral[1])
      const dir = new THREE.Vector3(L.dir[0], 0, L.dir[1])
      const base = L.center[1] - L.radius
      const topY = L.center[1] + L.radius + 0.5
      for (const side of [-1, 1]) {
        // outboard of the deck on each side (the loop drifts L.shift sideways)
        const off = side < 0 ? -(half + 2.2) : L.shift + half + 2.2
        const top = c.clone().addScaledVector(lat, off).setY(topY)
        for (const f of [-1, 1]) {
          const foot = c.clone().addScaledVector(lat, off + side * 6).addScaledVector(dir, f * L.radius * 0.9).setY(base)
          const len = foot.distanceTo(top)
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, len, 10), steel)
          leg.position.copy(foot).lerp(top, 0.5)
          leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(foot).normalize())
          leg.castShadow = true
          this.group.add(leg)
        }
        // cross-beam from the frame top to the loop's crown
        const crown = c.clone().addScaledVector(lat, L.shift * 0.5 + side * (half + 0.4)).setY(topY)
        const beamLen = crown.distanceTo(top)
        if (beamLen > 0.5) {
          const beam = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, beamLen), steel)
          beam.position.copy(top).lerp(crown, 0.5)
          beam.lookAt(crown)
          this.group.add(beam)
        }
      }
    }
  }

  private wetness = 0

  /** Rain: 0 dry … 1 soaked (darker, glossy asphalt with puddles). */
  setWetness(w: number): void {
    this.wetness = w
    if (this.roadShader) this.roadShader.uniforms['uWet']!.value = w
  }

  /** Underwater caustic shimmer on the road (0–1) + animation clock. */
  setCaustics(strength: number, time: number): void {
    if (!this.roadShader) return
    this.roadShader.uniforms['uCaustic']!.value = strength
    this.roadShader.uniforms['uTime']!.value = time % 1000
  }

  // ── Edge lines: white paint (land) / neon green (underwater) / cyan (ramp + space) ──
  /** Edge line style: white road paint everywhere (the neon variants are no longer used). */
  private lineMatFor(_i: number): 0 | 1 | 2 {
    return 0
  }

  /** Each area's light colour (road edges, underglow, streaks), per sample. */
  public readonly accents: THREE.Color[] = []
  private buildAccents(): void {
    const A: Record<string, number> = {
      town: 0xff7a3c, coast: 0xff5a7a, causeway: 0xff4fa0, underwater: 0x2cffd0, rampUp: 0x2cffd0, flight1: 0x66a8ff, space: 0x4fb4ff, flight2: 0x66a8ff,
      canyon: 0xff8a2a, loop: 0xff8a2a, volcano: 0xff3a10, desert: 0xffa01e, saltflat: 0xffe0a0, snow: 0x7fd4ff, sky: 0x46e6ff, roll: 0x46e6ff, flight3: 0x46e6ff,
      jungle: 0x4dff6a, city: 0xff2fd0,
    }
    const n = this.samples.length
    const raw = this.zones.map((z) => new THREE.Color(A[z] ?? 0xffffff))
    const W = 40
    for (let i = 0; i < n; i++) {
      const c = new THREE.Color(0, 0, 0)
      for (let o = -W; o <= W; o += 4) { const q = raw[(i + o + n) % n]!; c.r += q.r; c.g += q.g; c.b += q.b }
      this.accents.push(c.multiplyScalar(1 / (2 * W / 4 + 1)))
    }
  }

  private buildNeonEdgeLines(): void {
    this.buildAccents()
    const up = new THREE.Vector3(0, 1, 0)
    const LINE_OFFSET = this.width * 0.46
    const LINE_WIDTH = 0.38

    const materials = [
      // Glowing light strips, in each area's own colour
      new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      new THREE.MeshStandardMaterial({
        color: 0x22ff99,
        emissive: 0x00ff77,
        emissiveIntensity: 1.7,
        roughness: 0.3,
      }),
      new THREE.MeshStandardMaterial({
        color: 0x66eeff,
        emissive: 0x22ccff,
        emissiveIntensity: 2.0,
        roughness: 0.3,
      }),
    ] as const

    for (let side = -1; side <= 1; side += 2) {
      for (const run of this.roadRuns()) {
        // Split each run into sub-runs sharing one material
        let subStart = 0
        let subMat = this.lineMatFor(run[0]!)
        const flush = (startK: number, endK: number, matIdx: 0 | 1 | 2) => {
          if (endK <= startK) return
          const positions: number[] = []
          const indices: number[] = []
          const colors: number[] = []
          let vi = 0
          for (let k = startK; k <= endK; k++) {
            const idx = run[Math.min(k, run.length - 1)]!
            const p = this.samples[idx]!
            const tangent = this.tangents[idx]!
            const right = new THREE.Vector3().crossVectors(tangent, up).normalize()
            const lineCenter = p.clone().addScaledVector(right, side * LINE_OFFSET)
            const inner = lineCenter.clone().addScaledVector(right, -LINE_WIDTH / 2)
            const outer = lineCenter.clone().addScaledVector(right, LINE_WIDTH / 2)
            positions.push(inner.x, p.y + 0.07, inner.z, outer.x, p.y + 0.07, outer.z)
            const ac = this.accents[idx]!
            colors.push(ac.r * 1.4, ac.g * 1.4, ac.b * 1.4, ac.r * 1.4, ac.g * 1.4, ac.b * 1.4)
            if (k < endK) {
              indices.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2)
            }
            vi += 2
          }
          const geo = new THREE.BufferGeometry()
          geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
          geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
          geo.setIndex(indices)
          geo.computeVertexNormals()
          const line = new THREE.Mesh(geo, materials[matIdx])
          line.receiveShadow = true
          this.group.add(line)
        }

        for (let k = 1; k < run.length; k++) {
          const m = this.lineMatFor(run[k]!)
          if (m !== subMat) {
            flush(subStart, k, subMat)
            subStart = k
            subMat = m
          }
        }
        flush(subStart, run.length - 1, subMat)
      }
    }
  }

  // ── Checkered start line ─────────────────────────────────────────────
  private buildStartLine(): void {
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const cell = 16
    for (let y = 0; y < canvas.height / cell; y++) {
      for (let x = 0; x < canvas.width / cell; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#e8e8f0' : '#0a0a12'
        ctx.fillRect(x * cell, y * cell, cell, cell)
      }
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace

    const geo = new THREE.PlaneGeometry(this.width * 0.92, 4)
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    const p = this.spawnPosition
    const t = this.tangents[0]!
    mesh.position.set(p.x, p.y + 0.04, p.z)
    mesh.rotation.z = Math.atan2(t.x, t.z)
    mesh.receiveShadow = true
    this.group.add(mesh)
  }

  // ── Centerline queries (horizontal distance) ─────────────────────────
  private horizDist(a: THREE.Vector3, b: THREE.Vector3): number {
    const dx = a.x - b.x
    const dz = a.z - b.z
    return Math.sqrt(dx * dx + dz * dz)
  }

  nearest(position: THREE.Vector3, hintIndex: number, window = 40): NearestResult {
    const n = this.samples.length
    let minDist = Infinity
    let minIdx = hintIndex
    for (let o = -window; o <= window; o++) {
      const i = (hintIndex + o + n) % n
      const d = this.horizDist(position, this.samples[i]!)
      if (d < minDist) { minDist = d; minIdx = i }
    }
    return { index: minIdx, distance: minDist, point: this.samples[minIdx]! }
  }

  nearestGlobal(position: THREE.Vector3): NearestResult {
    const n = this.samples.length
    let minDist = Infinity
    let minIdx = 0
    for (let i = 0; i < n; i++) {
      const d = this.horizDist(position, this.samples[i]!)
      if (d < minDist) { minDist = d; minIdx = i }
    }
    return { index: minIdx, distance: minDist, point: this.samples[minIdx]! }
  }

  get sampleCount(): number {
    return this.samples.length
  }
}

export type { ZoneName }
