import * as THREE from 'three'
import { softDot } from './biomes/kit'
import type { Track } from './Track'
import { LOOPS } from './trackData'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { buildRoadDetails } from './RoadDetails'
import { Vegetation, WATER_RECTS } from './Vegetation'
import { UnderwaterWorld } from './Underwater'
import { habitat, solarFarm, landingPad, launchPad, rover, commsMast, edgeLights } from './SpaceBase'
import { buildingPool, setBuildingNightLights, type BuildingKind } from './Buildings'
import { treePool } from './Trees'
import { Biomes } from './biomes'
import { Countryside } from './biomes/Countryside'
import { buildSpaceExtras } from './SpaceExtras'

/**
 * Replace the cartoon low-poly town buildings with code-generated realistic
 * ones. Set to false if you downloaded real building models (REALISM-GUIDE
 * step 5) and want those used instead.
 */
const USE_PROCEDURAL_BUILDINGS = true
/** Same for palms and street trees (code-generated vs palm.glb / town_tree.glb). */
const USE_PROCEDURAL_TREES = true
const PROCEDURAL_FOR: Record<string, BuildingKind> = {
  townShop: 'shop', townStore: 'shop', townDiner: 'shop', townKiosk: 'shop',
  townAwning: 'mid', building: 'mid', house: 'mid',
  townTower2: 'tower', skyscraper: 'tower',
}
import { groundSet, rockSet, tiled, applyTextureOverrides, signFontsReady, photoSet } from './Textures'

const UP = new THREE.Vector3(0, 1, 0)
/** The base grass plane: big enough for the southern biomes too. */
const GROUND_SIZE = 3800

/**
 * Zone-aware world building driven by per-sample zone labels from Track:
 * town/coast (houses, palms, towers, ferris wheel, lighthouse), causeway
 * (railings, pillars, lamps), underwater (seabed + caustics, arches, kelp,
 * rocks, bubbles, shark, fish), launch ramps (support buttresses), SPACE
 * (floating moon plateau, craters, Earth, satellite), canyon (varied rock
 * spires + mesas), plus balloons, sailboats, mountains, camera flashes and
 * the HORIZON Drive start gate.
 */
export class Scenery {
  public readonly group: THREE.Group
  private readonly balloons: THREE.Group[] = []
  private readonly boats: THREE.Group[] = []
  private bubbles: THREE.Points | null = null
  private bubbleVel: Float32Array | null = null
  private bubbleBounds = { minY: -20, maxY: 0 }

  // Animated bits
  private oceanShaders: { uniforms: Record<string, THREE.IUniform> }[] = []
  /** Top-down mask of the dry dive trench (sea is cut out where it's set). */
  private readonly trenchMask: THREE.IUniform<THREE.Texture | null> = { value: null }
  private readonly trenchBox: THREE.IUniform<THREE.Vector4> = { value: new THREE.Vector4(0, 0, 1, 1) }
  private vegetation: Vegetation | null = null
  private underwater: UnderwaterWorld | null = null
  /** Everything that lives under the sea (tunnel, seabed, shark, fish, bubbles). */
  private readonly uwGroup = new THREE.Group()
  /** Everything on the floating moon plateau (only world shown while in space). */
  private readonly spaceGroup = new THREE.Group()
  /** Which self-contained world is showing alone right now, if any. */
  private exclusive: THREE.Group | null = null
  /** True once cliff/mountain models replaced the placeholder cone mountains. */
  private mountainsReplaced = false
  private readonly dryVisibility = new Map<THREE.Object3D, boolean>()
  private shark: THREE.Group | null = null
  private sharkTail: THREE.Object3D | null = null
  private sharkCenter = new THREE.Vector3()
  private fish: THREE.Points | null = null
  private fishData: Float32Array | null = null // per fish: phase, speed
  private fishBounds = new THREE.Box3()
  private ferris: THREE.Group | null = null
  private beacon: THREE.Object3D | null = null
  private satLight: THREE.Mesh | null = null
  private earth: THREE.Mesh | null = null

  // Camera flashes
  private flashSprites: THREE.Sprite[] = []
  private flashTimes: { t: number; spikes: number[] }[] = []

  // Section 6 additions
  private meteors: THREE.Points | null = null
  private meteorVel: Float32Array | null = null
  private industrialLights: THREE.Mesh[] = []
  private caveLamps: THREE.Mesh[] = []
  private palmSpots: { pos: THREE.Vector3; scale: number; rot: number }[] = []
  private proceduralPalms: THREE.Object3D[] = []
  /** Box-geometry placeholder houses, removed once real town models load. */
  private proceduralHouses: THREE.Object3D[] = []
  private modelsApplied = false
  private mountainMeshes: THREE.Mesh[] = []
  // Surface decoration hidden when the car is deep underwater (prevents
  // land models bleeding into the underwater world).
  private surfaceProps: THREE.Object3D[] = []
  /** Street lamp heads + the road point under them, for the night lights. */
  private lamps: { head: THREE.Vector3; ground: THREE.Vector3 }[] = []
  private nightLights: THREE.Group | null = null
  private nightBulbMat: THREE.MeshStandardMaterial | null = null
  private nightPoolMat: THREE.MeshBasicMaterial | null = null
  private nightLevel = 0
  private groundMat: THREE.MeshStandardMaterial | null = null

  /** Rain darkens soil and grass and gives it a slight sheen. */
  setWet(w: number): void {
    if (!this.groundMat) return
    this.groundMat.color.setScalar(1 - 0.38 * w)
    this.groundMat.roughness = 1 - 0.25 * w
  }
  /** Every static GLB placement, merged into a few big meshes by batchPlacedModels(). */
  private placed: THREE.Group[] = []

  constructor(private readonly track: Track) {
    this.group = new THREE.Group()
    this.buildGround()
    this.buildOcean()
    // Land builders were authored for the purple retrowave palette; run their
    // output through naturalize() so they read as real-world materials.
    // (Underwater and space keep their stylised looks.)
    const land = (build: () => void) => {
      const before = this.group.children.length
      build()
      for (const o of this.group.children.slice(before)) naturalize(o)
    }
    land(() => this.buildMountains())
    land(() => this.buildPalms())
    land(() => this.buildHouses())
    land(() => this.buildTowers())
    land(() => this.buildFerrisWheel())
    land(() => this.buildLighthouse())
    land(() => this.buildSailboats())
    land(() => this.buildBalloons())
    land(() => this.buildCauseway())
    land(() => this.buildRampSupports())
    land(() => this.buildEmbankments())
    // Underwater content goes in its own group so the whole surface world
    // can be hidden while the camera is below the sea
    const under = (build: () => void) => {
      const before = this.group.children.length
      build()
      for (const o of this.group.children.slice(before)) this.uwGroup.add(o)
    }
    this.group.add(this.uwGroup)
    under(() => this.buildUnderwater())
    under(() => this.buildShark())
    this.shark?.position.copy(this.sharkCenter) // start in the water, not at the world origin
    under(() => this.buildFish())
    // Space content in its own group too (shown alone while on the plateau)
    this.group.add(this.spaceGroup)
    const inSpace = (build: () => void) => {
      const before = this.group.children.length
      build()
      for (const o of this.group.children.slice(before)) this.spaceGroup.add(o)
    }
    inSpace(() => this.buildSpace())
    inSpace(() => this.buildSpaceIndustrial())
    inSpace(() => this.buildMeteors())
    inSpace(() => this.buildSpaceBase())
    inSpace(() => this.buildSpacePlay())
    inSpace(() => {
      // its own group, so props that load later still land inside the space world
      const g = new THREE.Group()
      this.group.add(g)
      this.spaceExtras = buildSpaceExtras(this.track, g, (x, z, r) => this.claimSpaceSpot(x, z, r))
    })
    land(() => this.buildCanyon())
    land(() => this.buildChevrons())
    land(() => this.buildRoadsidePosts())
    const details = buildRoadDetails(this.track) // kept out of naturalize(): real colors already
    this.group.add(details)
    this.surfaceProps.push(details)
    this.cullInstancesNearRoad() // before vegetation: grass is already kept off roads
    this.countryside = new Countryside(this.track)
    this.group.add(this.countryside.group)
    this.surfaceProps.push(this.countryside.group)
    // after the cull: the biomes keep their own props clear of the road (and
    // place barriers, poles and lamps at the edge on purpose)
    this.biomes = new Biomes(this.track, {
      addKicker: (i, g) => { this.kickers.push(i); this.kickerGravity.set(i, g) },
      addBoost: (i, lat, half) => { this.boostPads.push({ i, lat, half }) },
    })
    this.group.add(this.biomes.group, this.biomes.lights)
    for (const b of this.biomes.list) this.surfaceProps.push(b.group)
    this.vegetation = new Vegetation(this.track)
    this.group.add(this.vegetation.group)
    this.surfaceProps.push(this.vegetation.group)
    land(() => this.buildStartGate())
    this.buildCameraFlashes()
  }

  private rightAt(i: number): THREE.Vector3 {
    return new THREE.Vector3().crossVectors(this.track.tangents[i]!, UP).normalize()
  }

  // ── Ground & ocean ───────────────────────────────────────────────────
  /** The southern biomes (terrain, scenery, moods, particles). */
  biomes!: Biomes
  countryside!: Countryside
  private spaceExtras: { update(time: number): void } | null = null
  /** Kicker ramps outside space hop under normal gravity (sample → g). */
  readonly kickerGravity = new Map<number, number>()

  private buildGround(): void {
    // Dry grass / dirt with real surface detail. Color tiles every 40 m,
    // the fine normal detail every 6 m, so close-up and distance both read.
    const set = groundSet()
    const color = tiled(set, GROUND_SIZE / 40, GROUND_SIZE / 40)
    const fine = tiled(set, GROUND_SIZE / 6, GROUND_SIZE / 6)
    const mat = new THREE.MeshStandardMaterial({
      map: color.map,
      normalMap: fine.normalMap,
      roughnessMap: fine.roughnessMap,
      roughness: 1,
    })
    applyTextureOverrides(mat, 'ground')
    // The ground runs under the sea too: cut it out over the dry dive trench
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTrench'] = this.trenchMask
      shader.uniforms['uTrenchBox'] = this.trenchBox
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;\nuniform sampler2D uTrench;\nuniform vec4 uTrenchBox;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          {
            vec2 tuv = (vGroundXZ - uTrenchBox.xy) / (uTrenchBox.zw - uTrenchBox.xy);
            if (all(greaterThan(tuv, vec2(0.0))) && all(lessThan(tuv, vec2(1.0))) && texture2D(uTrench, tuv).r > 0.5) discard;
          }`)
    }
    this.groundMat = mat
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE), mat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.05
    ground.receiveShadow = true
    this.group.add(ground)
  }

  /**
   * Animated sea. Normals come from a sum of travelling waves evaluated per
   * pixel in world space (so the surface moves and catches the sun and sky
   * properly), fading to calm with distance to avoid sparkle aliasing. Foam
   * breaks along the plane edges, which is where the sea meets the coast.
   */
  private makeOceanMaterial(width: number, height: number): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x05212b, // deep sea blue-green
      roughness: 0.2,
      metalness: 0,
      envMapIntensity: 0.45,
      // Slightly see-through: a car diving in visibly goes INTO water (and
      // the tunnel shows faintly below) instead of vanishing into a floor
      transparent: true,
      opacity: 0.82,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 }
      shader.uniforms['uSize'] = { value: new THREE.Vector2(width, height) }
      shader.uniforms['uTrench'] = this.trenchMask
      shader.uniforms['uTrenchBox'] = this.trenchBox
      this.oceanShaders.push(shader)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vOceanWorld;\nvarying vec2 vOceanUv;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vOceanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vOceanUv = uv;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          varying vec3 vOceanWorld;
          varying vec2 vOceanUv;
          uniform float uTime;
          uniform vec2 uSize;
          uniform sampler2D uTrench;
          uniform vec4 uTrenchBox;
          float oceanFoam = 0.0;
          // Height-field slope (dh/dx, dh/dz) of several directional waves
          // fp = world-space size of one pixel; waves shorter than a few
          // pixels are faded out so distant water doesn't shimmer (moire).
          vec2 waveSlope(vec2 p, float t, float fp) {
            vec2 s = vec2(0.0);
            // dir.x, dir.y, wavelength (m), amplitude (m)
            vec4 W[6];
            W[0] = vec4( 0.8,  0.6, 22.0, 0.20);
            W[1] = vec4( 0.3,  0.95, 13.0, 0.12);
            W[2] = vec4(-0.6,  0.8,  7.0, 0.06);
            W[3] = vec4( 0.95,-0.3,  4.3, 0.035);
            W[4] = vec4(-0.2, -0.98, 2.6, 0.02);
            W[5] = vec4( 0.7,  0.7,  1.5, 0.010);
            for (int i = 0; i < 6; i++) {
              vec2 d = normalize(W[i].xy);
              float k = 6.2831853 / W[i].z;
              float speed = sqrt(9.81 / k); // deep-water dispersion
              float ph = k * dot(d, p) - k * speed * t;
              float aa = 1.0 - smoothstep(W[i].z * 0.12, W[i].z * 0.4, fp);
              s += d * (W[i].w * k * cos(ph)) * aa;
            }
            return s;
          }`)
        .replace('#include <clipping_planes_fragment>', /* glsl */ `#include <clipping_planes_fragment>
          {
            // No water over the dry trench where the road dips below sea level
            vec2 tuv = (vOceanWorld.xz - uTrenchBox.xy) / (uTrenchBox.zw - uTrenchBox.xy);
            if (all(greaterThan(tuv, vec2(0.0))) && all(lessThan(tuv, vec2(1.0))) && texture2D(uTrench, tuv).r > 0.5) discard;
          }`)
        .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
          {
            float dist = length(vOceanWorld - cameraPosition);
            float calm = 1.0 - smoothstep(30.0, 500.0, dist) * 0.55; // keep some chop far out
            float fp = length(fwidth(vOceanWorld.xz));
            vec2 sl = waveSlope(vOceanWorld.xz, uTime, fp) * calm;
            vec3 wn = normalize(vec3(-sl.x, 1.0, -sl.y));
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
            // Foam: distance (m) to the nearest plane edge, broken up by the waves
            vec2 e = min(vOceanUv, 1.0 - vOceanUv) * uSize;
            float edge = min(e.x, e.y);
            float n = sin(vOceanWorld.x * 0.35 + uTime * 0.9) * sin(vOceanWorld.z * 0.41 - uTime * 0.7);
            oceanFoam = (1.0 - smoothstep(0.0, 9.0 + n * 4.0, edge)) * (0.55 + 0.45 * n);
            oceanFoam = clamp(oceanFoam + max(sl.x + sl.y - 0.55, 0.0) * 0.6 * calm, 0.0, 1.0);
          }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.85, oceanFoam);`)
        .replace('#include <lights_fragment_begin>', `diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.88), oceanFoam);
          #include <lights_fragment_begin>`)
        // The flat, bright horizon sky turned the whole sea white at grazing
        // angles: damp the sky reflection (foam stays bright)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          reflectedLight.indirectSpecular *= mix(0.45, 1.0, oceanFoam);`)
    }
    return mat
  }

  private buildOcean(): void {
    // Main ocean east of the coast (under the causeway + dive)
    const ocean1 = new THREE.Mesh(new THREE.PlaneGeometry(700, 1100), this.makeOceanMaterial(700, 1100))
    ocean1.rotation.x = -Math.PI / 2
    ocean1.position.set(750, 0, 275) // reaches north over the underwater spiral
    this.group.add(ocean1)

    // Cove above the underwater tunnel (extends past the ramp shoreline)
    const ocean2 = new THREE.Mesh(new THREE.PlaneGeometry(480, 520), this.makeOceanMaterial(480, 520))
    ocean2.rotation.x = -Math.PI / 2
    ocean2.position.set(170, -0.01, 585) // a hair lower: no z-fighting where the two overlap
    this.group.add(ocean2)

    // No fixed glint mesh — it produced a bright spot off to the SIDE of the
    // sun. The ocean's env-map reflection of the baked sky (which contains the
    // sun disk) gives a natural reflection column directly below the sun.
  }

  private buildMountains(): void {
    const rock = tiled(rockSet(), 6, 3)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7d7468,
      map: rock.map,
      normalMap: rock.normalMap,
      roughness: 1,
      flatShading: true,
    })
    // Kept clear of the space plateau (x -370..-540, z -60..300)
    const positions: [number, number, number, number][] = [
      [80, 760, 280, 120],
      [-330, 620, 240, 130],
      [-850, 340, 300, 170],
      [-920, -120, 320, 180],
      [-500, 560, 220, 115],
    ]
    for (const [x, z, r, h] of positions) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), mat)
      m.position.set(x, h / 2 - 4, z)
      m.rotation.y = Math.random() * Math.PI
      this.group.add(m)
      this.mountainMeshes.push(m)
    }
  }

  // ── Palms (instanced) in town / coast zones ──────────────────────────
  private buildPalms(): void {
    const spots: { pos: THREE.Vector3; scale: number; rot: number }[] = []
    const n = this.track.sampleCount
    for (let i = 0; i < n; i += 11) {
      const zone = this.track.zoneOfSample(i)
      if (!(zone === 'town' || zone === 'coast') || Math.random() < 0.25) continue
      const p = this.track.samples[i]!
      if (p.y < -1) continue
      const right = this.rightAt(i)
      const side = Math.random() < 0.5 ? -1 : 1
      const dist = 11 + Math.random() * 8
      const pos = p.clone().addScaledVector(right, side * dist)
      pos.y = 0
      spots.push({ pos, scale: 0.85 + Math.random() * 0.5, rot: Math.random() * Math.PI * 2 })
    }
    this.palmSpots = spots

    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.26, 6.5, 6)
    trunkGeo.translate(0, 3.25, 0)
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1425, roughness: 1 })
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, spots.length)
    trunks.castShadow = true

    const frondGeo = new THREE.ConeGeometry(0.34, 3.4, 4)
    const frondMat = new THREE.MeshStandardMaterial({
      color: 0x142012,
      roughness: 1,
      flatShading: true,
    })
    const FRONDS = 6
    const fronds = new THREE.InstancedMesh(frondGeo, frondMat, spots.length * FRONDS)
    fronds.castShadow = true

    const frondLocals: THREE.Matrix4[] = []
    for (let k = 0; k < FRONDS; k++) {
      const angle = (k / FRONDS) * Math.PI * 2
      const m = new THREE.Matrix4()
        .multiply(new THREE.Matrix4().makeRotationY(-angle))
        .multiply(new THREE.Matrix4().makeTranslation(1.15, 6.7, 0))
        .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 + 0.7))
        .multiply(new THREE.Matrix4().makeScale(1, 1, 0.25))
      frondLocals.push(m)
    }

    const dummy = new THREE.Object3D()
    const frondMatrix = new THREE.Matrix4()
    spots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(0, s.rot, 0)
      dummy.scale.setScalar(s.scale)
      dummy.updateMatrix()
      trunks.setMatrixAt(i, dummy.matrix)
      for (let k = 0; k < FRONDS; k++) {
        frondMatrix.multiplyMatrices(dummy.matrix, frondLocals[k]!)
        fronds.setMatrixAt(i * FRONDS + k, frondMatrix)
      }
    })
    this.group.add(trunks, fronds)
    this.proceduralPalms = [trunks, fronds]
  }

  // ── Suburban homes in the town zone ──────────────────────────────────
  private buildHouses(): void {
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x241040,
      roughness: 0.95,
      flatShading: true,
    })
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x180830,
      roughness: 1,
      flatShading: true,
    })
    const windowMats = [
      new THREE.MeshStandardMaterial({ color: 0xffaa44, emissive: 0xff8800, emissiveIntensity: 1.8 }),
      new THREE.MeshStandardMaterial({ color: 0xff77bb, emissive: 0xff44aa, emissiveIntensity: 1.6 }),
      new THREE.MeshStandardMaterial({ color: 0x77eedd, emissive: 0x33ccbb, emissiveIntensity: 1.5 }),
    ]

    const makeHouse = (): THREE.Group => {
      const h = new THREE.Group()
      const w = 6 + Math.random() * 4
      const d = 5 + Math.random() * 3
      const ht = 3 + Math.random() * 1.5

      const base = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), baseMat)
      base.position.y = ht / 2
      base.castShadow = true
      base.receiveShadow = true
      h.add(base)

      const roof = new THREE.Mesh(new THREE.ConeGeometry(d * 0.78, 2.2, 4), roofMat)
      roof.scale.set(w / d, 1, 1)
      roof.position.y = ht + 1.1
      roof.rotation.y = Math.PI / 4
      roof.castShadow = true
      h.add(roof)

      const winMat = windowMats[Math.floor(Math.random() * windowMats.length)]!
      const winCount = 1 + Math.floor(Math.random() * 3)
      for (let i = 0; i < winCount; i++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), winMat)
        win.position.set(
          -w / 2 + 1.4 + i * ((w - 2.8) / Math.max(winCount - 1, 1)),
          ht * 0.5,
          d / 2 + 0.02
        )
        h.add(win)
      }
      return h
    }

    const n = this.track.sampleCount
    for (let i = 0; i < n; i += 12) {
      if (this.track.zoneOfSample(i) !== 'town') continue
      const p = this.track.samples[i]!
      const right = this.rightAt(i)
      // Place on BOTH sides at varied depth (near row + occasional far row) so
      // the town reads as a dense lived-in street with layered depth.
      for (const side of [-1, 1] as const) {
        if (Math.random() < 0.18) continue
        const near = 22 + Math.random() * 10
        const pos = p.clone().addScaledVector(right, side * near)
        const house = makeHouse()
        house.position.set(pos.x, 0, pos.z)
        house.rotation.y = Math.atan2(right.x * -side, right.z * -side)
        this.group.add(house)
        this.surfaceProps.push(house)
        this.proceduralHouses.push(house)
        // occasional second row further back for depth
        if (Math.random() < 0.5) {
          const far = near + 12 + Math.random() * 14
          const pos2 = p.clone().addScaledVector(right, side * far)
          const house2 = makeHouse()
          house2.position.set(pos2.x, 0, pos2.z)
          house2.rotation.y = Math.atan2(right.x * -side, right.z * -side)
          this.group.add(house2)
          this.surfaceProps.push(house2)
          this.proceduralHouses.push(house2)
        }
      }
    }
  }

  // ── Towers south of town ─────────────────────────────────────────────
  private towerTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, 64, 128)
    const palette = ['#ffc98a', '#ffe6c4', '#fff2dc', '#d6e4ff'] // warm + cool interior light
    for (let y = 6; y < 122; y += 10) {
      for (let x = 5; x < 58; x += 9) {
        if (Math.random() < 0.62) {
          const r = Math.random()
          ctx.fillStyle = r < 0.6 ? palette[0]! : r < 0.8 ? palette[1]! : r < 0.92 ? palette[2]! : palette[3]!
          ctx.fillRect(x, y, 5, 6)
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.magFilter = THREE.NearestFilter
    return tex
  }

  private buildTowers(): void {
    const winTex = this.towerTexture()
    // Glass-and-steel office towers: reflect the sky, a few warm lit windows.
    const towerMat = new THREE.MeshStandardMaterial({
      color: 0x55606a,
      roughness: 0.18,
      metalness: 0.7,
      emissive: 0xffffff,
      emissiveMap: winTex,
      emissiveIntensity: 0.35,
    })

    const stripeCanvas = document.createElement('canvas')
    stripeCanvas.width = 32
    stripeCanvas.height = 128
    const sctx = stripeCanvas.getContext('2d')!
    for (let y = 0; y < 128; y += 8) {
      sctx.fillStyle = y % 16 === 0 ? '#ff8866' : '#2a0a45'
      sctx.fillRect(0, y, 32, 8)
    }
    const stripeTex = new THREE.CanvasTexture(stripeCanvas)
    stripeTex.colorSpace = THREE.SRGBColorSpace
    const hotelMat = new THREE.MeshStandardMaterial({
      map: stripeTex,
      roughness: 0.8,
      emissive: 0x883322,
      emissiveMap: stripeTex,
      emissiveIntensity: 0.5,
    })

    const towers: [number, number, number, number, number, THREE.Material][] = [
      [-150, -140, 26, 96, 22, towerMat], // landmark tower — tallest structure in town (glass, like the rest)
      [-60, -160, 20, 55, 20, towerMat],
      [30, -175, 24, 68, 24, towerMat],
      [120, -165, 18, 48, 18, towerMat],
      [215, -150, 22, 62, 22, towerMat],
      [300, -125, 16, 40, 16, towerMat],
      [175, -195, 20, 74, 20, towerMat],
    ]
    for (const [x, z, w, h, d, mat] of towers) {
      // this skyline predates the southern route: drop any tower it now hits
      if (this.track.samples.some((p) => Math.hypot(p.x - x, p.z - z) < 40 + Math.max(w, d) / 2)) continue
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
      tower.position.set(x, h / 2, z)
      tower.castShadow = true
      this.group.add(tower)
    }
  }

  // ── Ferris wheel on the coast ────────────────────────────────────────
  private buildFerrisWheel(): void {
    const wheel = new THREE.Group()
    const R = 20
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2a1050,
      roughness: 0.7,
      emissive: 0xff44aa,
      emissiveIntensity: 0.35,
    })

    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.5, 8, 40), frameMat)
    wheel.add(rim)
    for (let k = 0; k < 8; k++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.4, R * 2, 0.4), frameMat)
      spoke.rotation.z = (k / 8) * Math.PI
      wheel.add(spoke)
    }
    const cabinColors = [0xff44aa, 0x44ddff, 0xffaa33, 0xcc66ff]
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      const cabin = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 2.2, 2.2),
        new THREE.MeshStandardMaterial({
          color: cabinColors[k % 4]!,
          emissive: cabinColors[k % 4]!,
          emissiveIntensity: 0.8,
          roughness: 0.6,
        })
      )
      cabin.position.set(Math.cos(a) * R, Math.sin(a) * R, 0)
      wheel.add(cabin)
    }
    wheel.position.set(395, R + 4, -150)
    this.ferris = wheel

    const holder = new THREE.Group()
    holder.add(wheel)
    // A-frame supports
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1a0830, roughness: 0.9 })
    for (const sx of [-7, 7]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, R + 6, 1.4), legMat)
      leg.position.set(395 + sx, (R + 6) / 2, -150)
      leg.rotation.z = sx > 0 ? -0.25 : 0.25
      holder.add(leg)
    }
    this.group.add(holder)
  }

  // ── Lighthouse behind the start gate ─────────────────────────────────
  private buildLighthouse(): void {
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 128
    const ctx = c.getContext('2d')!
    for (let y = 0; y < 128; y += 16) {
      ctx.fillStyle = (y / 16) % 2 === 0 ? '#e8dede' : '#cc3344'
      ctx.fillRect(0, y, 32, 16)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace

    const lh = new THREE.Group()
    const towerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 3.2, 22, 10),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })
    )
    towerMesh.position.y = 11
    towerMesh.castShadow = true
    lh.add(towerMesh)

    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(1.6, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0xffeeaa,
        emissive: 0xffcc55,
        emissiveIntensity: 2.4,
      })
    )
    lamp.position.y = 23.4
    lh.add(lamp)

    // Rotating light beam
    const beamGroup = new THREE.Group()
    beamGroup.position.y = 23.4
    const beam = new THREE.Mesh(
      new THREE.ConeGeometry(5, 60, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffdd88,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    )
    beam.rotation.z = Math.PI / 2
    beam.position.x = 30
    beamGroup.add(beam)
    lh.add(beamGroup)
    this.beacon = beamGroup
    beamGroup.visible = false // shown at night only (setNight)

    lh.position.set(-30, 0, 45)
    this.group.add(lh)
  }

  // ── Sailboats & balloons ─────────────────────────────────────────────
  private buildSailboats(): void {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0x1a0f2e, roughness: 0.7 })
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xf5e8f0,
      roughness: 0.9,
      side: THREE.DoubleSide,
      flatShading: true,
    })

    for (let i = 0; i < 10; i++) {
      const boat = new THREE.Group()
      const scale = 0.8 + Math.random() * 1.6

      const hull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 4), hullMat)
      hull.position.y = 0.3
      boat.add(hull)

      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6, 5), hullMat)
      mast.position.y = 3.2
      boat.add(mast)

      const sailShape = new THREE.Shape()
      sailShape.moveTo(0, 0)
      sailShape.lineTo(0, 5)
      sailShape.lineTo(2.2, 0.3)
      sailShape.lineTo(0, 0)
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), sailMat)
      sail.position.set(0.06, 0.9, 0)
      sail.rotation.y = Math.PI / 2
      boat.add(sail)

      boat.scale.setScalar(scale)
      boat.position.set(560 + Math.random() * 400, 0, -150 + Math.random() * 650)
      boat.rotation.y = Math.random() * Math.PI * 2
      this.group.add(boat)
      this.boats.push(boat)
    }
  }

  private buildBalloons(): void {
    const colors = [0xe23a4e, 0xff7080, 0xd94a8c, 0xff5540]
    for (let i = 0; i < 5; i++) {
      const balloon = new THREE.Group()
      const envelope = new THREE.Mesh(
        new THREE.SphereGeometry(5, 10, 8),
        new THREE.MeshStandardMaterial({
          color: colors[i % colors.length]!,
          roughness: 0.8,
          flatShading: true,
        })
      )
      envelope.scale.y = 1.15
      balloon.add(envelope)
      const basket = new THREE.Mesh(
        new THREE.BoxGeometry(1.6, 1.4, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x241028, roughness: 1 })
      )
      basket.position.y = -7.2
      balloon.add(basket)

      balloon.position.set(
        420 + Math.random() * 420,
        45 + Math.random() * 45,
        -60 + Math.random() * 420
      )
      balloon.userData['baseY'] = balloon.position.y
      balloon.userData['phase'] = Math.random() * Math.PI * 2
      this.group.add(balloon)
      this.balloons.push(balloon)
    }
  }

  // ── Causeway: railings, support pillars, lamps ───────────────────────
  private buildCauseway(): void {
    const track = this.track
    const n = track.sampleCount
    const half = track.width / 2

    const inCauseway = (i: number): boolean =>
      track.zoneOfSample(i) === 'causeway' && track.samples[i]!.y > -2.5

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x8a5fc8,
      roughness: 0.6,
      flatShading: true,
      side: THREE.DoubleSide,
    })
    for (let side = -1; side <= 1; side += 2) {
      const positions: number[] = []
      const indices: number[] = []
      let vi = 0
      let prevIn = false
      for (let i = 0; i <= n; i++) {
        const idx = i % n
        const isIn = inCauseway(idx)
        if (!isIn) { prevIn = false; continue }
        const p = track.samples[idx]!
        const right = this.rightAt(idx)
        const base = p.clone().addScaledVector(right, side * (half + 0.4))
        positions.push(base.x, p.y + 0.02, base.z, base.x, p.y + 1.0, base.z)
        if (prevIn) {
          indices.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi)
        }
        vi += 2
        prevIn = true
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setIndex(indices)
      geo.computeVertexNormals()
      this.group.add(new THREE.Mesh(geo, railMat))
    }

    // Pillars down to the water
    const pillarSpots: { pos: THREE.Vector3; h: number }[] = []
    for (let i = 0; i < n; i += 16) {
      if (!inCauseway(i)) continue
      const p = track.samples[i]!
      const h = p.y + 4
      pillarSpots.push({ pos: new THREE.Vector3(p.x, p.y - h / 2, p.z), h })
    }
    const pillarGeo = new THREE.BoxGeometry(5, 1, 3.2)
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x4a1a66,
      roughness: 0.9,
      flatShading: true,
    })
    const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarSpots.length)
    const dummy = new THREE.Object3D()
    pillarSpots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.scale.set(1, s.h, 1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      pillars.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(pillars)

    // Lamps: poles + glowing heads, alternating sides
    const lampSpots: THREE.Vector3[] = []
    let lampSide = 1
    for (let i = 0; i < n; i += 24) {
      if (!inCauseway(i)) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const pos = p.clone().addScaledVector(right, lampSide * (half + 0.6))
      lampSpots.push(pos)
      this.recordLamp(pos, 4.75, right.clone().multiplyScalar(-lampSide), p.y, 0)
      lampSide *= -1
    }
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 4.6, 5)
    poleGeo.translate(0, 2.3, 0)
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a1040, roughness: 0.8 })
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length)
    const headGeo = new THREE.SphereGeometry(0.32, 8, 6)
    headGeo.translate(0, 4.7, 0)
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xffddaa,
      emissive: 0xffaa55,
      emissiveIntensity: 1.7,
    })
    const heads = new THREE.InstancedMesh(headGeo, headMat, lampSpots.length)
    lampSpots.forEach((pos, i) => {
      dummy.position.copy(pos)
      dummy.scale.set(1, 1, 1)
      dummy.updateMatrix()
      poles.setMatrixAt(i, dummy.matrix)
      heads.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(poles, heads)
  }

  // ── Launch ramp support buttresses (coverage: no floating road) ──────
  private buildRampSupports(): void {
    const track = this.track
    const n = track.sampleCount
    const spots: { pos: THREE.Vector3; h: number; yaw: number }[] = []
    for (let i = 0; i < n; i += 10) {
      if (track.zoneOfSample(i) !== 'rampUp') continue
      const p = track.samples[i]!
      if (p.y < 0.5) continue
      // Top sits under the LOWEST road point it spans, so the sloped ramp
      // never has a support poking up through it
      const top = this.minRoadY(i, 5) - 0.45
      const h = top + 1
      const t = track.tangents[i]!
      spots.push({ pos: new THREE.Vector3(p.x, top - h / 2, p.z), h, yaw: Math.atan2(t.x, t.z) })
    }
    if (spots.length === 0) return
    const geo = new THREE.BoxGeometry(track.width * 0.7, 1, 4)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x8e8b84, // poured concrete (was neon purple)
      roughness: 0.9,
      flatShading: true,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length)
    const dummy = new THREE.Object3D()
    spots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(0, s.yaw, 0)
      dummy.scale.set(1, s.h, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(mesh)
  }

  /** Jersey-style concrete barriers along both edges of the launch ramp. */
  private buildRampBarriers(): void {
    const track = this.track
    const n = track.sampleCount
    // Jersey profile (across × up), extruded 1 m along the road
    const sh = new THREE.Shape()
    sh.moveTo(-0.3, 0); sh.lineTo(0.3, 0); sh.lineTo(0.3, 0.08); sh.lineTo(0.12, 0.3)
    sh.lineTo(0.09, 0.85); sh.lineTo(-0.09, 0.85); sh.lineTo(-0.12, 0.3); sh.lineTo(-0.3, 0.08)
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false })
    geo.translate(0, 0, -0.5)
    const mat = new THREE.MeshStandardMaterial({ color: 0xb5b2aa, roughness: 0.9 })
    const mats: THREE.Matrix4[] = []
    const UP = new THREE.Vector3(0, 1, 0)
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      if (track.zoneOfSample(i) !== 'rampUp') continue
      const p = track.samples[i]!, p2 = track.samples[(i + 1) % n]!
      if (p.y < 0.3) continue // still in the trench: its walls do the job
      const len = p.distanceTo(p2)
      const fwd = p2.clone().sub(p).normalize()
      const right = new THREE.Vector3().crossVectors(fwd, UP).normalize()
      const up = new THREE.Vector3().crossVectors(right, fwd)
      m4.makeBasis(right, up, fwd.clone().negate())
      q.setFromRotationMatrix(m4)
      for (const side of [-1, 1]) {
        const c = p.clone().lerp(p2, 0.5).addScaledVector(right, side * (track.width / 2 + 0.5))
        s.set(1, 1, len * 1.02)
        mats.push(new THREE.Matrix4().compose(c, q, s))
      }
    }
    if (!mats.length) return
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length)
    mats.forEach((m, k) => mesh.setMatrixAt(k, m))
    mesh.computeBoundingSphere()
    mesh.castShadow = mesh.receiveShadow = true
    this.group.add(mesh)
  }

  /** Lowest road height within ±`span` samples of i. */
  private minRoadY(i: number, span: number): number {
    const n = this.track.sampleCount
    let m = Infinity
    for (let k = -span; k <= span; k++) m = Math.min(m, this.track.samples[(i + k + n) % n]!.y)
    return m
  }

  // ── Generic coverage pass: NO road sample may float unsupported ──────
  // Any elevated sample not covered by causeway pillars, ramp buttresses
  // or the space plateau gets a solid earthen embankment down to ground.
  private buildEmbankments(): void {
    const track = this.track
    const n = track.sampleCount
    const covered: ReadonlySet<string> = new Set(['causeway', 'rampUp', 'space', 'flight1', 'flight2', 'loop',
      'volcano', 'desert', 'saltflat', 'snow', 'sky', 'roll', 'flight3', 'jungle', 'city'])

    const spots: { pos: THREE.Vector3; h: number; yaw: number }[] = []
    for (let i = 0; i < n; i += 4) {
      const zone = track.zoneOfSample(i)
      if (covered.has(zone)) continue
      const p = track.samples[i]!
      if (p.y < 0.6) continue
      const top = this.minRoadY(i, 4) - 0.2 // never above the road on slopes
      const h = top + 0.5
      const t = track.tangents[i]!
      spots.push({
        pos: new THREE.Vector3(p.x, top - h / 2, p.z),
        h,
        yaw: Math.atan2(t.x, t.z),
      })
    }
    if (spots.length === 0) return

    const geo = new THREE.BoxGeometry(track.width + 3, 1, 7)
    const mat = new THREE.MeshStandardMaterial({
      color: 0x2a1445,
      roughness: 1,
      flatShading: true,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length)
    const dummy = new THREE.Object3D()
    spots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(0, s.yaw, 0)
      dummy.scale.set(1, s.h, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(mesh)
  }

  /** Roadside billboard: two steel posts, a framed printed ad on both faces. */
  private makeBillboard(): THREE.Group {
    const ads = [
      { bg: ['#0e3a5c', '#1d6f98'], title: 'COASTLINE', sub: 'COFFEE ROASTERS', fg: '#f5e6c8' },
      { bg: ['#2b1a12', '#7a3a1c'], title: 'AERO TYRES', sub: 'GRIP IN EVERY WEATHER', fg: '#ffd27a' },
      { bg: ['#f2efe6', '#d9d3c4'], title: 'SUNSET 98.4', sub: 'DRIVE-TIME RADIO', fg: '#c2402a' },
    ]
    const ad = ads[this.billboardCount++ % ads.length]!
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 192
    const ctx = c.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 512, 192)
    g.addColorStop(0, ad.bg[0]!)
    g.addColorStop(1, ad.bg[1]!)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 192)
    const paint = (): void => {
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 512, 192)
      ctx.fillStyle = ad.fg
      ctx.textAlign = 'center'
      ctx.font = 'italic 800 92px "Barlow Condensed", Arial, sans-serif'
      ctx.fillText(ad.title, 256, 108)
      ctx.font = '600 30px Rajdhani, Arial, sans-serif'
      ctx.fillText(ad.sub.split('').join(String.fromCharCode(8202)), 256, 154)
    }
    paint()
    const tex = new THREE.CanvasTexture(c)
    signFontsReady().then(() => { paint(); tex.needsUpdate = true })
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4

    const steel = new THREE.MeshStandardMaterial({ color: 0x6d7276, metalness: 0.7, roughness: 0.45 })
    const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })
    const grp = new THREE.Group()
    for (const x of [-2.6, 2.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 6, 8), steel)
      post.position.set(x, 3, 0)
      grp.add(post)
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(8.4, 3.3, 0.3), steel)
    frame.position.y = 7.3
    grp.add(frame)
    for (const s of [1, -1]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), face)
      panel.position.set(0, 7.3, s * 0.16)
      if (s < 0) panel.rotation.y = Math.PI
      grp.add(panel)
    }
    grp.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
    return grp
  }
  private billboardCount = 0

  /** Paint the dry trench's footprint (road + walls) into the ocean's cut-out mask. */
  private buildTrenchMask(idx: number[]): void {
    if (!idx.length) return
    const t = this.track
    const pts = idx.map((i) => t.samples[i]!)
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const p of pts) { x0 = Math.min(x0, p.x); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); z1 = Math.max(z1, p.z) }
    const pad = t.width
    x0 -= pad; z0 -= pad; x1 += pad; z1 += pad
    const mpp = Math.max(0.4, Math.max(x1 - x0, z1 - z0) / 2048) // metres per pixel
    const c = document.createElement('canvas')
    c.width = Math.ceil((x1 - x0) / mpp)
    c.height = Math.ceil((z1 - z0) / mpp)
    const ctx = c.getContext('2d')!
    ctx.strokeStyle = '#fff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = (t.width + 2.4) / mpp // road + both walls
    ctx.beginPath()
    idx.forEach((i, k) => {
      const p = t.samples[i]!
      const px = (p.x - x0) / mpp, py = (p.z - z0) / mpp
      if (k === 0 || i !== idx[k - 1]! + 1) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    })
    ctx.stroke()
    const tex = new THREE.CanvasTexture(c)
    tex.flipY = false
    this.trenchMask.value = tex
    this.trenchBox.value.set(x0, z0, x1, z1)
  }

  // ── Underwater tunnel zone ───────────────────────────────────────────
  private buildUnderwater(): void {
    const track = this.track
    const n = track.sampleCount
    const isUw = (i: number): boolean =>
      track.zoneOfSample(i) === 'underwater' && track.samples[i]!.y < -1.5

    // Seabed, trench walls, glass tunnel, kelp, coral, rocks, sunbeams and
    // the underside of the sea surface (see Underwater.ts)
    this.underwater = new UnderwaterWorld(track, WATER_RECTS)
    this.group.add(this.underwater.group)
    this.buildTrenchMask(this.underwater.trenchIdx)

    // Bubbles
    const uwSamples = track.samples.filter((_, i) => isUw(i))
    if (uwSamples.length > 0) {
      const box = new THREE.Box3().setFromPoints(uwSamples)
      box.expandByScalar(24)
      this.bubbleBounds = { minY: box.min.y, maxY: 1 }
      this.fishBounds.copy(box)
      const COUNT = 220
      const positions = new Float32Array(COUNT * 3)
      this.bubbleVel = new Float32Array(COUNT)
      for (let i = 0; i < COUNT; i++) {
        positions[i * 3] = THREE.MathUtils.lerp(box.min.x, box.max.x, Math.random())
        positions[i * 3 + 1] = THREE.MathUtils.lerp(box.min.y, 0, Math.random())
        positions[i * 3 + 2] = THREE.MathUtils.lerp(box.min.z, box.max.z, Math.random())
        this.bubbleVel[i] = 1.2 + Math.random() * 2.2
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      const mat = new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.04,
        color: 0xaef4ff,
        size: 0.32,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      })
      this.bubbles = new THREE.Points(geo, mat)
      this.bubbles.frustumCulled = false
      this.group.add(this.bubbles)

      // Shark patrol center: middle of the underwater zone
      box.getCenter(this.sharkCenter)
      this.sharkCenter.y = box.min.y + 8
    }
  }

  // ── The shark ────────────────────────────────────────────────────────
  private buildShark(): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x22303e,
      roughness: 0.9,
      flatShading: true,
    })
    const belly = new THREE.MeshStandardMaterial({
      color: 0x39485a,
      roughness: 0.9,
      flatShading: true,
    })

    const shark = new THREE.Group()

    // Body: stretched sphere, nose toward -Z
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat)
    body.scale.set(1.6, 1.5, 6.5)
    shark.add(body)

    const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), belly)
    bellyMesh.scale.set(1.5, 1.2, 5.8)
    bellyMesh.position.y = -0.4
    shark.add(bellyMesh)

    // Dorsal fin
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.2, 4), mat)
    dorsal.scale.z = 0.25
    dorsal.position.set(0, 2.4, 0.5)
    dorsal.rotation.x = -0.25
    shark.add(dorsal)

    // Pectoral fins
    for (const sx of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.4, 4), mat)
      fin.scale.z = 0.22
      fin.position.set(sx * 1.9, -0.4, -1.2)
      fin.rotation.z = sx * (Math.PI / 2 + 0.5)
      shark.add(fin)
    }

    // Tail fin (kept as a handle for wagging)
    const tail = new THREE.Group()
    const tailFin = new THREE.Mesh(new THREE.ConeGeometry(1.6, 3.6, 4), mat)
    tailFin.scale.z = 0.22
    tailFin.rotation.x = 0.5
    tailFin.position.z = 1.2
    tail.add(tailFin)
    const tailFin2 = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.4, 4), mat)
    tailFin2.scale.z = 0.22
    tailFin2.rotation.x = Math.PI - 0.5
    tailFin2.position.z = 1.1
    tail.add(tailFin2)
    tail.position.set(0, 0.2, 6.2)
    shark.add(tail)
    this.sharkTail = tail

    shark.scale.setScalar(2.2) // ~30m — a real spectacle
    this.shark = shark
    this.group.add(shark)
  }

  // ── Fish school (single Points draw call with a sprite texture) ──────
  private makeFishTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas')
    c.width = 32
    c.height = 32
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'rgba(0,0,0,0)'
    ctx.clearRect(0, 0, 32, 32)
    ctx.fillStyle = '#9fe8ff'
    // Body
    ctx.beginPath()
    ctx.ellipse(14, 16, 9, 4.5, 0, 0, Math.PI * 2)
    ctx.fill()
    // Tail
    ctx.beginPath()
    ctx.moveTo(22, 16)
    ctx.lineTo(29, 10)
    ctx.lineTo(29, 22)
    ctx.closePath()
    ctx.fill()
    const tex = new THREE.CanvasTexture(c)
    return tex
  }

  private buildFish(): void {
    if (this.fishBounds.isEmpty()) return
    const COUNT = 60
    const positions = new Float32Array(COUNT * 3)
    this.fishData = new Float32Array(COUNT * 2)
    const b = this.fishBounds
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = THREE.MathUtils.lerp(b.min.x, b.max.x, Math.random())
      positions[i * 3 + 1] = THREE.MathUtils.lerp(b.min.y + 3, -4, Math.random())
      positions[i * 3 + 2] = THREE.MathUtils.lerp(b.min.z, b.max.z, Math.random())
      this.fishData[i * 2] = Math.random() * Math.PI * 2       // phase
      this.fishData[i * 2 + 1] = 2.5 + Math.random() * 3.5      // speed
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({
      map: this.makeFishTexture(),
      size: 1.5,
      transparent: true,
      alphaTest: 0.3,
      depthWrite: false,
      color: 0xffffff,
      sizeAttenuation: true,
    })
    this.fish = new THREE.Points(geo, mat)
    this.fish.frustumCulled = false
    this.group.add(this.fish)
  }

  // ── SPACE: floating moon plateau, craters, Earth, satellite ──────────
  /**
   * Earth from orbit: noise-generated continents (green → desert by
   * latitude), deep oceans, ice caps and swirling cloud bands. Seamless in
   * longitude so the sphere has no visible join.
   */
  private makeEarthTexture(): THREE.CanvasTexture {
    const W = 512, H = 256
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(W, H)
    let s = 31
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
    const G = 64
    const lattice = new Float32Array(G * G * G).map(() => rnd())
    // 3D value noise sampled on the sphere surface = seamless
    const n3 = (x: number, y: number, z: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
      const xf = x - xi, yf = y - yi, zf = z - zi
      const sm = (t: number) => t * t * (3 - 2 * t)
      const L = (a: number, b: number, c2: number) => lattice[(((a % G) + G) % G) * G * G + (((b % G) + G) % G) * G + (((c2 % G) + G) % G)]!
      const u = sm(xf), v = sm(yf), w = sm(zf)
      const lerp = (a: number, b: number, t: number) => a + (b - a) * t
      return lerp(
        lerp(lerp(L(xi, yi, zi), L(xi + 1, yi, zi), u), lerp(L(xi, yi + 1, zi), L(xi + 1, yi + 1, zi), u), v),
        lerp(lerp(L(xi, yi, zi + 1), L(xi + 1, yi, zi + 1), u), lerp(L(xi, yi + 1, zi + 1), L(xi + 1, yi + 1, zi + 1), u), v), w)
    }
    const fbm = (x: number, y: number, z: number, oct: number) => {
      let v = 0, a = 0.5, f = 1
      for (let o = 0; o < oct; o++) { v += a * n3(x * f + 11, y * f + 7, z * f + 3); a *= 0.5; f *= 2.03 }
      return v
    }
    for (let py = 0; py < H; py++) {
      const lat = (0.5 - py / H) * Math.PI
      for (let px = 0; px < W; px++) {
        const lon = (px / W) * Math.PI * 2
        const x = Math.cos(lat) * Math.cos(lon), y = Math.sin(lat), z = Math.cos(lat) * Math.sin(lon)
        const land = fbm(x * 2.2, y * 2.2, z * 2.2, 5)
        const cloud = fbm(x * 4 + 20, y * 7, z * 4, 5)
        const absLat = Math.abs(y)
        let r: number, g: number, b: number
        if (land > 0.53) {
          const dry = Math.max(0, 1 - Math.abs(absLat - 0.35) * 4) * 0.8 // desert belts
          const k = (land - 0.53) * 4
          // Muted, photographic land tones (forest olive → desert tan)
          r = 62 + dry * 85 + k * 25; g = 74 + dry * 50 + k * 15; b = 44 + dry * 28
        } else {
          const d = Math.min(1, (0.53 - land) * 6)
          r = 14 - d * 8; g = 38 - d * 18; b = 78 - d * 22 // deep navy ocean
        }
        if (absLat > 0.9 - land * 0.1) { r = 220; g = 226; b = 232 } // ice caps
        const cl = Math.max(0, Math.min(1, (cloud - 0.5) * 3)) * 0.92
        r = r + (245 - r) * cl; g = g + (248 - g) * cl; b = b + (252 - b) * cl
        const o = (py * W + px) * 4
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  private buildSpace(): void {
    const track = this.track
    const n = track.sampleCount
    const isSpace = (i: number): boolean => track.zoneOfSample(i) === 'space'

    // Moon plateau: wide grey ribbon under the space road
    {
      const positions: number[] = []
      const uvs: number[] = []
      const indices: number[] = []
      let vi = 0
      let prevIn = false
      for (let i = 0; i < n; i++) {
        if (!isSpace(i)) { prevIn = false; continue }
        const p = track.samples[i]!
        const right = this.rightAt(i)
        // 62 m each side (room for the base); just under the road surface so
        // the road sits flush on the ground instead of on a 1.6 m ledge
        const left = p.clone().addScaledVector(right, -62)
        const rightPt = p.clone().addScaledVector(right, 62)
        positions.push(left.x, p.y - 0.12, left.z, rightPt.x, p.y - 0.12, rightPt.z)
        uvs.push(left.x / 10, left.z / 10, rightPt.x / 10, rightPt.z / 10)
        if (prevIn) indices.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi)
        vi += 2
        prevIn = true
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
      geo.setIndex(indices)
      geo.computeVertexNormals()
      // Lunar regolith: grey dusty rock with real surface detail
      const regolith = photoSet('moon_01')
      const plateau = new THREE.Mesh(
        geo,
        // Double-sided: seen from the lower road the plateau is a solid slab
        // (single-sided, its underside vanished and the rock chunks and tanks
        // hanging off it looked like they were floating)
        new THREE.MeshStandardMaterial({ color: 0xc8c6c2, map: regolith.map, normalMap: regolith.normalMap, roughness: 1, side: THREE.DoubleSide })
      )
      plateau.receiveShadow = true
      this.group.add(plateau)
    }

    // Jagged asteroid underside — big grey chunks hanging below the plateau
    const chunkSpots: { pos: THREE.Vector3; s: number; rot: number }[] = []
    for (let i = 0; i < n; i += 18) {
      if (!isSpace(i)) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const off = (Math.random() - 0.5) * 50
      const s = 7 + Math.random() * 9
      // Top of the chunk (0.8·s above its centre) tucked under the plateau,
      // so none pokes through the surface or floats beside the road
      const pos = p.clone().addScaledVector(right, off).setY(p.y - 2.2 - s * 0.8 - Math.random() * 3)
      // Skip chunks hanging over another, lower stretch of road (they'd
      // dangle in front of the car there)
      const reach = s * 1.3 + track.width
      let over = false
      for (let k = 0; k < n && !over; k += 3) {
        const q = track.samples[k]!
        const near = (q.x - pos.x) ** 2 + (q.z - pos.z) ** 2 < reach * reach
        if (near && (q.y < p.y - 4 || pos.y + s * 1.3 > q.y - 1)) over = true
      }
      if (over) continue
      chunkSpots.push({
        pos,
        s,
        rot: Math.random() * Math.PI * 2,
      })
    }
    const moonRock = tiled(rockSet(), 1, 1)
    const chunkGeo = lumpyRock(1)
    const chunkMat = new THREE.MeshStandardMaterial({
      color: 0x6e6d6a, map: moonRock.map, normalMap: moonRock.normalMap, roughness: 1,
    })
    const chunks = new THREE.InstancedMesh(chunkGeo, chunkMat, chunkSpots.length)
    const dummy = new THREE.Object3D()
    chunkSpots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(s.rot, s.rot * 1.7, 0)
      dummy.scale.set(s.s, s.s * 0.8, s.s)
      dummy.updateMatrix()
      chunks.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(chunks)

    // Craters: flat rings on the plateau surface
    const craterSpots: { pos: THREE.Vector3; s: number }[] = []
    for (let i = 0; i < n; i += 14) {
      if (!isSpace(i) || Math.random() < 0.35) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const side = Math.random() < 0.5 ? -1 : 1
      const dist = track.width / 2 + 6 + Math.random() * 26
      craterSpots.push({
        pos: p.clone().addScaledVector(right, side * dist).setY(p.y + 0.13),
        s: 1.5 + Math.random() * 3.5,
      })
    }
    const craterGeo = new THREE.TorusGeometry(1, 0.22, 6, 14)
    craterGeo.rotateX(-Math.PI / 2)
    const craterMat = new THREE.MeshStandardMaterial({
      color: 0x807f7b, map: moonRock.map, normalMap: moonRock.normalMap, roughness: 1,
    })
    const craters = new THREE.InstancedMesh(craterGeo, craterMat, craterSpots.length)
    craterSpots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(0, Math.random() * Math.PI, 0)
      dummy.scale.setScalar(s.s)
      dummy.updateMatrix()
      craters.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(craters)

    // Grey moon rocks
    const mrSpots: { pos: THREE.Vector3; s: number; rot: number }[] = []
    for (let i = 0; i < n; i += 10) {
      if (!isSpace(i) || Math.random() < 0.5) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const side = Math.random() < 0.5 ? -1 : 1
      const dist = track.width / 2 + 4 + Math.random() * 30
      mrSpots.push({
        pos: p.clone().addScaledVector(right, side * dist).setY(p.y + 0.08),
        s: 0.8 + Math.random() * 2.6,
        rot: Math.random() * Math.PI * 2,
      })
    }
    const mrGeo = lumpyRock(1)
    const mrMat = new THREE.MeshStandardMaterial({
      color: 0x8a8984, map: moonRock.map, normalMap: moonRock.normalMap, roughness: 1,
    })
    const moonRocks = new THREE.InstancedMesh(mrGeo, mrMat, mrSpots.length)
    mrSpots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(0, s.rot, s.rot * 0.3)
      dummy.scale.setScalar(s.s)
      dummy.updateMatrix()
      moonRocks.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(moonRocks)

    // Earth — big and low over the far horizon, self-lit, unaffected by fog
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(85, 24, 18),
      new THREE.MeshBasicMaterial({
        map: this.makeEarthTexture(),
        fog: false,
        transparent: true,
        opacity: 0.35, // faint from the surface; full when in the space zone
      })
    )
    earth.position.set(-980, 175, 120)
    this.earth = earth
    this.group.add(earth)
    // Thin blue atmosphere glow around the limb
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(89, 32, 24),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float r = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(vec3(0.35,0.6,1.0) * r * 1.4, 1.0); }',
      })
    )
    earth.add(atmo)

    // Satellite dish on the plateau with a blinking light
    const midIdx = (() => {
      const idxs: number[] = []
      for (let i = 0; i < n; i++) if (isSpace(i)) idxs.push(i)
      return idxs[Math.floor(idxs.length / 2)] ?? -1
    })()
    if (midIdx >= 0) {
      const p = track.samples[midIdx]!
      const right = this.rightAt(midIdx)
      const base = p.clone().addScaledVector(right, 26)
      const sat = new THREE.Group()
      const mast = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.6, 9, 6),
        new THREE.MeshStandardMaterial({ color: 0x8a90a0, roughness: 0.6, metalness: 0.6 })
      )
      mast.position.y = 4.5
      sat.add(mast)
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 3),
        new THREE.MeshStandardMaterial({
          color: 0xb8bece,
          roughness: 0.4,
          metalness: 0.7,
          side: THREE.DoubleSide,
        })
      )
      dish.position.y = 9.5
      dish.rotation.x = -Math.PI / 3
      sat.add(dish)
      const light = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xff3344, emissive: 0xff2233, emissiveIntensity: 2 })
      )
      light.position.y = 10.5
      sat.add(light)
      this.satLight = light
      sat.position.set(base.x, p.y - 0.12, base.z)
      this.group.add(sat)
    }
  }

  // ── Canyon zone: varied rock spires + mesas + foreground rocks ───────
  private buildCanyon(): void {
    const track = this.track
    const n = track.sampleCount
    const inCanyon = (i: number): boolean =>
      track.zoneOfSample(i) === 'canyon' && track.samples[i]!.y > -1

    // The canyon sits on the far side of the map from the sun, so it needs
    // its own fill lights or it renders near-black. Keep the COUNT LOW —
    // too many dynamic lights tanks the renderer. A handful of wide-range
    // point lights covers the whole corridor.
    let litCanyon = 0
    for (let i = 0; i < n && litCanyon < 5; i += 8) {
      if (!inCanyon(i)) continue
      if (i % 40 !== 0) continue
      const p = track.samples[i]!
      const warm = litCanyon % 2 === 0
      const light = new THREE.PointLight(warm ? 0xff8855 : 0xcc55dd, 5, 240, 1.5)
      light.position.set(p.x, p.y + 30, p.z)
      this.group.add(light)
      litCanyon++
    }

    const spireSpots: { pos: THREE.Vector3; s: THREE.Vector3; rot: number; tilt: number }[] = []
    // Last stretch before the town: no spires standing among the buildings
    const nearTown = (i: number): boolean => {
      for (let k = 1; k <= 70; k++) if (track.zoneOfSample((i + k) % n) === 'town') return true
      return false
    }
    for (let i = 0; i < n; i += 7) {
      if (!inCanyon(i) || nearTown(i) || Math.random() < 0.25) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const side = Math.random() < 0.5 ? -1 : 1
      const radius = 3 + Math.random() * 3
      const dist = track.width / 2 + radius + 3 + Math.random() * 9
      const pos = p.clone().addScaledVector(right, side * dist)
      pos.y = 0
      const height = 8 + Math.random() * 16
      spireSpots.push({
        pos,
        s: new THREE.Vector3(radius, height, 3 + Math.random() * 3),
        rot: Math.random() * Math.PI * 2,
        tilt: (Math.random() - 0.5) * 0.22,
      })
    }
    // Weathered spire: a many-sided cone with noisy, layered sides (a plain
    // 6-sided cone read as a paper party hat)
    // Hoodoo: a tapering rock tower with a blunt, lumpy top and irregular
    // sides (not a perfect point, no regular rings)
    const spireGeo = new THREE.CylinderGeometry(0.28, 1, 1, 12, 6)
    spireGeo.translate(0, 0.5, 0)
    {
      const pa = spireGeo.getAttribute('position') as THREE.BufferAttribute
      for (let k = 0; k < pa.count; k++) {
        const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k)
        const a = Math.atan2(z, x)
        const bump = 1 + 0.18 * Math.sin(a * 2 + y * 3.1) + 0.1 * Math.sin(a * 5 + 1.3 - y * 2.2)
        const lean = 0.12 * y * y // slight lean / overhang near the top
        pa.setXYZ(k, x * bump + lean, y, z * bump)
      }
      spireGeo.computeVertexNormals()
    }
    const spireMat = canyonRock(0xa07a5a)
    const spires = new THREE.InstancedMesh(spireGeo, spireMat, spireSpots.length)
    spires.castShadow = true
    const dummy = new THREE.Object3D()
    spireSpots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(s.tilt, s.rot, s.tilt * 0.6)
      dummy.scale.copy(s.s)
      dummy.updateMatrix()
      spires.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(spires)

    // Small foreground rocks close to the road edges (outside the clearance)
    const fgSpots: { pos: THREE.Vector3; s: number; rot: number }[] = []
    for (let i = 0; i < n; i += 9) {
      if (!inCanyon(i) || Math.random() < 0.45) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const side = Math.random() < 0.5 ? -1 : 1
      const dist = track.width / 2 + 1.5 + Math.random() * 4
      fgSpots.push({
        pos: p.clone().addScaledVector(right, side * dist).setY(0),
        s: 0.5 + Math.random() * 1.1,
        rot: Math.random() * Math.PI * 2,
      })
    }
    const fgGeo = new THREE.IcosahedronGeometry(1, 0)
    const fgMat = canyonRock(0x9a7658)
    const fgRocks = new THREE.InstancedMesh(fgGeo, fgMat, fgSpots.length)
    fgSpots.forEach((s, i) => {
      dummy.position.copy(s.pos)
      dummy.rotation.set(0, s.rot, 0)
      dummy.scale.setScalar(s.s)
      dummy.updateMatrix()
      fgRocks.setMatrixAt(i, dummy.matrix)
    })
    this.group.add(fgRocks)

    // Big mesas further out
    const mesaMat = canyonRock(0x94705a)
    for (let i = 0; i < n; i += 60) {
      if (!inCanyon(i) || Math.random() < 0.4) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const side = Math.random() < 0.5 ? -1 : 1
      const w = 18 + Math.random() * 14
      const pos = p.clone().addScaledVector(right, side * (track.width / 2 + w + 18 + Math.random() * 50))
      const h = 14 + Math.random() * 20
      const mesa = new THREE.Mesh(mesaGeometry(w, h), mesaMat)
      mesa.position.set(pos.x, h / 2, pos.z)
      mesa.rotation.y = Math.random() * Math.PI
      this.group.add(mesa)
    }
  }

  // ── Space industrial structures (tanks, pipes, gantries) ─────────────
  private buildSpaceIndustrial(): void {
    const track = this.track
    const n = track.sampleCount
    const isSpace = (i: number): boolean => track.zoneOfSample(i) === 'space'

    // Real-world base hardware: brushed steel tanks, grey pipework, orange
    // safety bands (no neon)
    const steelMat = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.45, metalness: 0.8 })
    const pipeMat = new THREE.MeshStandardMaterial({ color: 0x8e9398, roughness: 0.5, metalness: 0.7 })
    const bandMat = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.6 })

    for (let i = 0; i < n; i += 22) {
      if (!isSpace(i) || Math.random() < 0.4) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const side = Math.random() < 0.5 ? -1 : 1
      // on the plateau (it ends 62 m out), clear of the road and the base
      const off = 34 + Math.random() * 18
      const base = p.clone().addScaledVector(right, side * off)
      if (!this.claimSpaceSpot(base.x, base.z, 12)) continue
      const cluster = new THREE.Group()

      // Tall storage tanks
      const tanks = 1 + Math.floor(Math.random() * 3)
      for (let k = 0; k < tanks; k++) {
        const h = 14 + Math.random() * 20
        const r = 3 + Math.random() * 3
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), steelMat)
        tank.position.set(k * (r * 2.4), h / 2, k * 2)
        cluster.add(tank)
        const band = new THREE.Mesh(new THREE.TorusGeometry(r + 0.1, 0.25, 6, 12), bandMat)
        band.rotation.x = Math.PI / 2
        band.position.set(k * (r * 2.4), h * 0.7, k * 2)
        cluster.add(band)
        const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), steelMat)
        cap.position.set(k * (r * 2.4), h, k * 2)
        cluster.add(cap)
      }
      // Diagonal gantry pipe reaching toward the road
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 40, 8), pipeMat)
      pipe.position.set(-8, 16, 4)
      pipe.rotation.z = 0.7
      cluster.add(pipe)

      cluster.position.set(base.x, p.y - 0.12, base.z)
      cluster.rotation.y = Math.random() * Math.PI
      this.group.add(cluster)
    }

    // Steel lighting gantries spanning the road: two legs, a truss beam and
    // a row of amber lamps (replaces the old neon rings)
    const gantrySteel = new THREE.MeshStandardMaterial({ color: 0x9da2a7, roughness: 0.5, metalness: 0.75 })
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xffb050, emissiveIntensity: 2.2 })
    const span = track.width + 4
    for (let i = 0; i < n; i += 40) {
      if (!isSpace(i)) continue
      const p = track.samples[i]!
      const t = track.tangents[i]!
      const gantry = new THREE.Group()
      for (const sx of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, 9, 0.6), gantrySteel)
        leg.position.set(sx * span / 2, 4.5, 0)
        gantry.add(leg)
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 0.6, 0.7, 0.9), gantrySteel)
      beam.position.y = 9
      gantry.add(beam)
      for (let k = -2; k <= 2; k++) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.5), lampMat)
        lamp.position.set(k * span / 5.5, 8.55, 0)
        gantry.add(lamp)
      }
      gantry.position.set(p.x, p.y, p.z)
      gantry.rotation.y = Math.atan2(t.x, t.z) // local X (legs, beam) spans across the road
      gantry.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
      this.group.add(gantry)
    }
  }

  /** Space plateau spots already taken (x, z, radius). */
  private spaceSpots: [number, number, number][] = []
  private claimSpaceSpot(x: number, z: number, r: number): boolean {
    for (const [sx, sz, sr] of this.spaceSpots) if ((x - sx) ** 2 + (z - sz) ** 2 < (r + sr) ** 2) return false
    // and clear of every stretch of road (the space run curls back on itself)
    const t = this.track
    for (let i = 0; i < t.sampleCount; i += 3) {
      const p = t.samples[i]!
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < (r + t.width / 2 + 3) ** 2) return false
    }
    this.spaceSpots.push([x, z, r])
    return true
  }

  /** Lunar base: habitat, solar farms, landing + launch pads, rovers, masts, edge lights. */
  private buildSpaceBase(): void {
    const t = this.track
    const n = t.sampleCount
    const idx: number[] = []
    for (let i = 0; i < n; i++) if (t.zoneOfSample(i) === 'space') idx.push(i)
    if (!idx.length) return
    const half = t.width / 2
    const items: [() => THREE.Group, number, number][] = [
      // builder, footprint radius, where along the run (0–1)
      [() => launchPad(), 22, 0.12],
      [() => habitat(), 25, 0.35],
      [() => solarFarm(3, 5), 14, 0.45],
      [() => landingPad(), 15, 0.6],
      [() => solarFarm(2, 6), 14, 0.72],
      [() => habitat(), 25, 0.85],
      [() => rover(), 4, 0.28],
      [() => rover(), 4, 0.66],
      [() => solarFarm(3, 4), 12, 0.2],
      [() => solarFarm(2, 5), 12, 0.93],
    ]
    for (const [make, r, at] of items) {
      // try a few spots near the requested point, either side
      for (let tryN = 0; tryN < 24; tryN++) {
        const k = THREE.MathUtils.clamp(Math.round((at + (tryN >> 1) * 0.015 * (tryN % 2 ? 1 : -1)) * idx.length), 0, idx.length - 1)
        const i = idx[k]!
        const p = t.samples[i]!
        const right = this.rightAt(i)
        const side = (tryN + Math.round(at * 10)) % 2 ? 1 : -1
        const maxOff = 60 - r * 0.6
        const minOff = half + r + 4
        if (maxOff < minOff) continue
        const off = minOff + Math.random() * (maxOff - minOff)
        const pos = p.clone().addScaledVector(right, side * off)
        if (!this.claimSpaceSpot(pos.x, pos.z, r)) continue
        const obj = make()
        obj.position.set(pos.x, p.y - 0.12, pos.z)
        obj.rotation.y = Math.atan2(-right.x * side, -right.z * side) // face the road
        this.group.add(obj)
        break
      }
    }
    // Comms masts with blinking beacons
    for (const at of [0.05, 0.5, 0.98]) {
      const i = idx[Math.floor(at * (idx.length - 1))]!
      const p = t.samples[i]!
      const right = this.rightAt(i)
      const pos = p.clone().addScaledVector(right, (at > 0.4 && at < 0.6 ? 1 : -1) * (half + 9))
      if (!this.claimSpaceSpot(pos.x, pos.z, 3)) continue
      const m = commsMast()
      m.group.position.set(pos.x, p.y - 0.12, pos.z)
      this.group.add(m.group)
      this.spaceBeacons.push(m.beacon)
    }
    // Runway-style blue edge lights along both sides of the space road
    const pts: THREE.Vector3[] = []
    for (let k = 0; k < idx.length; k += 6) {
      const i = idx[k]!
      const p = t.samples[i]!
      const right = this.rightAt(i)
      for (const s of [-1, 1]) pts.push(p.clone().addScaledVector(right, s * (half + 0.9)).setY(p.y + 0.05))
    }
    this.group.add(edgeLights(pts))
  }
  private spaceBeacons: THREE.Mesh[] = []

  /** Low-gravity jump ramps: sample index at each ramp's lip. */
  public readonly kickers: number[] = []
  /** Boost pads: sample index, lateral centre (m, + = right) and half-width. */
  public readonly boostPads: { i: number; lat: number; half: number }[] = []
  private padMats: THREE.MeshBasicMaterial[] = []
  private scrollTex: THREE.Texture[] = []
  private station: THREE.Group | null = null

  /** Space gameplay: jump ramps, boost pads, and a ring station overhead. */
  private buildSpacePlay(): void {
    const t = this.track
    const n = t.sampleCount
    const idx: number[] = []
    for (let i = 0; i < n; i++) if (t.zoneOfSample(i) === 'space') idx.push(i)
    if (idx.length < 50) return
    const half = t.width / 2
    // Straightest sample near a fraction of the run (ramps want a straight)
    const straightNear = (at: number) => {
      let best = idx[Math.floor(at * idx.length)]!, bestTurn = Infinity
      for (let k = -30; k <= 30; k++) {
        const i = idx[THREE.MathUtils.clamp(Math.floor(at * idx.length) + k, 12, idx.length - 40)]!
        const a = t.tangents[i]!, b = t.tangents[(i + 30) % n]!
        const turn = Math.abs(a.x * b.z - a.z * b.x) + Math.abs(a.y - b.y)
        if (turn < bestTurn) { bestTurn = turn; best = i }
      }
      return best
    }

    // ── Jump ramps: a steel wedge across the road with a hazard-striped lip
    const stripe = (() => {
      const c = document.createElement('canvas')
      c.width = 256; c.height = 32
      const g = c.getContext('2d')!
      for (let x = -32; x < 256; x += 32) {
        g.fillStyle = '#f2c400'; g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 32); g.fill()
        g.fillStyle = '#151515'; g.beginPath(); g.moveTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 48, 0); g.lineTo(x + 32, 32); g.fill()
      }
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = THREE.RepeatWrapping
      tex.repeat.x = 4
      return tex
    })()
    const rampSteel = new THREE.MeshStandardMaterial({ color: 0x8c9297, metalness: 0.7, roughness: 0.45 })
    // faintly self-lit so the ramp reads in the dark of space
    const lipMat = new THREE.MeshStandardMaterial({ map: stripe, emissiveMap: stripe, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.6 })
    // scrolling neon chevrons up the ramp deck
    const launchTex = (() => {
      const c = document.createElement('canvas')
      c.width = 256; c.height = 256
      const g = c.getContext('2d')!
      g.fillStyle = '#060a14'
      g.fillRect(0, 0, 256, 256)
      g.strokeStyle = '#ff2fd0'
      g.lineWidth = 26
      g.lineJoin = 'miter'
      for (let k = 0; k < 2; k++) {
        const x = 40 + k * 128
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 70, 128); g.lineTo(x, 256); g.stroke()
      }
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.repeat.set(1.6, 4)
      return tex
    })()
    this.scrollTex.push(launchTex)
    const launchMat = new THREE.MeshBasicMaterial({ map: launchTex, toneMapped: false, color: 0xffffff })
    const archMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 2.2, 2.6), toneMapped: false })
    const pinkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.3, 1.9), toneMapped: false })
    for (const at of [0.1, 0.4, 0.7]) {
      const lip = straightNear(at)
      const p = t.samples[lip]!
      const tg = t.tangents[lip]!
      // Wedge: rises 1.7 m over 13 m, full road width
      const L = 13, H = 1.7
      const sh = new THREE.Shape()
      sh.moveTo(0, 0); sh.lineTo(L, 0); sh.lineTo(L, H); sh.lineTo(L - 0.4, H)
      const geo = new THREE.ExtrudeGeometry(sh, { depth: t.width - 1, bevelEnabled: false })
      geo.translate(-L, 0, -(t.width - 1) / 2)
      const ramp = new THREE.Group()
      ramp.add(new THREE.Mesh(geo, rampSteel))
      // hazard stripes across the top of the slope, where the driver sees them
      const slope = Math.atan2(H, L)
      const deckGeo = new THREE.PlaneGeometry(L / Math.cos(slope), t.width - 1.4)
      deckGeo.rotateX(-Math.PI / 2)
      const deck = new THREE.Mesh(deckGeo, launchMat)
      deck.rotation.z = slope
      deck.position.set(-L / 2, H / 2 + 0.05, 0)
      ramp.add(deck)
      const lipGeo = new THREE.BoxGeometry(0.5, 0.25, t.width - 1)
      const lipFace = new THREE.Mesh(lipGeo, lipMat)
      lipFace.position.set(-0.25, H + 0.1, 0)
      ramp.add(lipFace)
      // a glowing launch arch over the lip, with side pylons
      const arch = new THREE.Mesh(new THREE.TorusGeometry(t.width / 2 + 1.2, 0.32, 10, 48, Math.PI), archMat)
      arch.rotation.y = Math.PI / 2
      arch.position.set(0, 0, 0)
      ramp.add(arch)
      const arch2 = new THREE.Mesh(new THREE.TorusGeometry(t.width / 2 + 2.2, 0.18, 8, 48, Math.PI), pinkMat)
      arch2.rotation.y = Math.PI / 2
      arch2.position.set(-3, 0, 0)
      ramp.add(arch2)
      for (const s of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(L, 0.14, 0.14), pinkMat)
        rail.rotation.z = slope
        rail.position.set(-L / 2, H / 2 + 0.3, s * (t.width / 2 - 0.5))
        ramp.add(rail)
      }
      ramp.position.set(p.x, p.y + 0.02, p.z)
      // local +X = direction of travel
      ramp.rotation.y = Math.atan2(-tg.z, tg.x)
      ramp.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
      this.group.add(ramp)
      this.kickers.push(lip)
    }

    // ── Boost pads: glowing chevrons in one lane (alternating sides)
    const padTex = (() => {
      const c = document.createElement('canvas')
      c.width = 128; c.height = 256
      const g = c.getContext('2d')!
      g.fillStyle = '#04121c'
      g.fillRect(0, 0, 128, 256)
      g.strokeStyle = '#38d8ff'
      g.lineWidth = 14
      g.lineJoin = 'miter'
      for (let k = 0; k < 3; k++) {
        const y = 200 - k * 70
        g.beginPath(); g.moveTo(14, y); g.lineTo(64, y - 46); g.lineTo(114, y); g.stroke()
      }
      g.strokeStyle = '#9feeff'
      g.lineWidth = 4
      g.strokeRect(4, 4, 120, 248)
      const tex = new THREE.CanvasTexture(c)
      tex.colorSpace = THREE.SRGBColorSpace
      return tex
    })()
    let k = 0
    padTex.wrapT = THREE.RepeatWrapping
    this.scrollTex.push(padTex)
    for (const at of [0.05, 0.35, 0.65, 0.95]) {
      const i = idx[Math.floor(at * idx.length)]!
      const p = t.samples[i]!
      const tg = t.tangents[i]!
      const lat = (k++ % 2 ? 1 : -1) * half * 0.5
      const right = this.rightAt(i)
      const mat = new THREE.MeshBasicMaterial({ map: padTex, toneMapped: false, transparent: true })
      this.padMats.push(mat)
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(7.5, 16), mat)
      const c = p.clone().addScaledVector(right, lat)
      pad.position.set(c.x, p.y + 0.06, c.z)
      // flat on the road, chevrons pointing the way you drive
      pad.rotation.order = 'YXZ'
      pad.rotation.set(-Math.PI / 2, Math.atan2(tg.x, tg.z) + Math.PI, 0)
      this.group.add(pad)
      // a soft pool of light so the pad reads from far down the road
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0x38d8ff, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }))
      glow.position.set(c.x, p.y + 1, c.z)
      glow.scale.set(16, 8, 1)
      this.group.add(glow)
      this.boostPads.push({ i, lat, half: 3.9 })
    }

    // ── Ring station turning slowly high above the plateau
    const st = new THREE.Group()
    const hull = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, metalness: 0.5, roughness: 0.45 })
    const panels = new THREE.MeshStandardMaterial({ color: 0x14254a, metalness: 0.6, roughness: 0.3 })
    const lights = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 2.2 })
    st.add(new THREE.Mesh(new THREE.TorusGeometry(70, 5, 16, 96), hull))
    st.add(new THREE.Mesh(new THREE.TorusGeometry(70, 5.3, 4, 96, Math.PI * 2), lights)).scale.set(1, 1, 0.12)
    for (let s2 = 0; s2 < 4; s2++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 140, 10), hull)
      spoke.rotation.z = (s2 / 4) * Math.PI
      st.add(spoke)
    }
    st.add(new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 26, 20), hull))
    for (const sgn of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(110, 0.5, 18), panels)
      wing.position.z = sgn * 22
      wing.rotation.x = Math.PI / 2
      st.add(wing)
    }
    const mid = t.samples[idx[Math.floor(idx.length / 2)]!]!
    st.position.set(mid.x + 120, mid.y + 260, mid.z - 80)
    st.rotation.set(1.1, 0.4, 0)
    this.group.add(st)
    this.station = st
  }

  // ── Meteor / shooting-star streaks across the space sky ──────────────
  private buildMeteors(): void {
    const COUNT = 40
    const positions = new Float32Array(COUNT * 3)
    this.meteorVel = new Float32Array(COUNT * 3)
    // Anchor around the space plateau
    const track = this.track
    let cx = -450, cz = 150, cy = 120
    const box = new THREE.Box3()
    const spacePts = track.samples.filter((_, i) => track.zoneOfSample(i) === 'space')
    if (spacePts.length) { box.setFromPoints(spacePts); const c = new THREE.Vector3(); box.getCenter(c); cx = c.x; cz = c.z; cy = box.max.y + 90 }
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = cx + (Math.random() - 0.5) * 900
      positions[i * 3 + 1] = cy + (Math.random() - 0.5) * 220
      positions[i * 3 + 2] = cz + (Math.random() - 0.5) * 900
      const sp = 40 + Math.random() * 60
      this.meteorVel[i * 3] = -sp
      this.meteorVel[i * 3 + 1] = -sp * 0.35
      this.meteorVel[i * 3 + 2] = sp * 0.5
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    const mat = new THREE.PointsMaterial({ map: softDot(), alphaTest: 0.04,
      color: 0xffffff, size: 2.2, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
    this.meteors = new THREE.Points(geo, mat)
    this.meteors.frustumCulled = false
    this.meteors.userData['origin'] = { cx, cy, cz }
    this.group.add(this.meteors)
  }

  // ── Canyon cave: road passes through a tunnel bored in a mountain ─────
  private buildCanyonCave(): void {
    const track = this.track
    const n = track.sampleCount
    // Choose the canyon sample nearest the middle of the canyon zone
    const canyonIdx: number[] = []
    for (let i = 0; i < n; i++) if (track.zoneOfSample(i) === 'canyon' && track.samples[i]!.y > -1) canyonIdx.push(i)
    if (canyonIdx.length < 20) return
    const mid = canyonIdx[Math.floor(canyonIdx.length * 0.3)]! // before the loop arena
    const p = track.samples[mid]!
    const t = track.tangents[mid]!
    const yaw = Math.atan2(t.x, t.z)

    // Mountain built AROUND the road, never through it: two shoulder masses
    // fully clear of the drivable surface, a roof slab bridging over the
    // road with a clear tunnel gap, and a peak on top. (The previous version
    // was a solid cone ON the road — you drove straight through its face.)
    const mtnMat = canyonRock(0x8f6d55)
    mtnMat.userData['canyonRock'] = false // the cave hill arches over the road on purpose
    const half = track.width / 2
    const clearance = half + 4      // lateral free space beside the road
    const gapHeight = 13            // vertical free space over the road
    const right = this.rightAt(mid)

    for (const off of [-1, 1]) {
      const shR = 42
      const sh = new THREE.Mesh(new THREE.ConeGeometry(shR, 68, 6), mtnMat)
      sh.position.copy(p.clone().addScaledVector(right, off * (clearance + shR)))
      sh.position.y = 30
      sh.castShadow = true
      this.group.add(sh)
      // Portal cheek walls: fill the space between shoulder and tunnel mouth
      // above the gap, flush with the road sides but never inside them
      const cheek = new THREE.Mesh(new THREE.BoxGeometry(shR * 1.6, 26, 34), mtnMat)
      cheek.position.copy(p.clone().addScaledVector(right, off * (clearance + shR * 0.8)))
      cheek.position.y = gapHeight + 13
      cheek.rotation.y = yaw
      this.group.add(cheek)
    }
    // Roof slab bridging the road (bottom sits above the tunnel gap)
    const roof = new THREE.Mesh(new THREE.BoxGeometry(clearance * 2 + 84, 26, 40), mtnMat)
    roof.position.set(p.x, gapHeight + 13, p.z)
    roof.rotation.y = yaw
    this.group.add(roof)
    // Peak on top for the mountain silhouette
    const peak = new THREE.Mesh(new THREE.ConeGeometry(52, 55, 6), mtnMat)
    peak.position.set(p.x, gapHeight + 26 + 18, p.z)
    peak.rotation.y = Math.random() * Math.PI
    this.group.add(peak)

    // Tunnel: a dark ring corridor following ~30 samples through the mountain
    const tunnelMat = canyonRock(0x6f5a4a)
    tunnelMat.side = THREE.BackSide
    tunnelMat.userData['canyonRock'] = false // the road runs through this tunnel
    const ringR = half + 4
    const positions: number[] = []
    const indices: number[] = []
    const SEG = 14
    const from = -18, to = 18
    let ring = 0
    for (let o = from; o <= to; o++) {
      const idx = (mid + o + n) % n
      const cp = track.samples[idx]!
      const tan = track.tangents[idx]!
      const right = new THREE.Vector3().crossVectors(tan, UP).normalize()
      const up = new THREE.Vector3().crossVectors(right, tan).normalize()
      for (let s = 0; s <= SEG; s++) {
        const a = (s / SEG) * Math.PI // half-dome arch
        const x = Math.cos(a) * ringR
        const y = Math.sin(a) * (ringR * 0.9)
        const v = cp.clone().addScaledVector(right, x).addScaledVector(up, y)
        v.y += 0.2
        positions.push(v.x, v.y, v.z)
      }
      if (ring > 0) {
        const b = ring * (SEG + 1)
        const pb = (ring - 1) * (SEG + 1)
        for (let s = 0; s < SEG; s++) {
          indices.push(pb + s, b + s, pb + s + 1, b + s, b + s + 1, pb + s + 1)
        }
      }
      ring++
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    const tunnel = new THREE.Mesh(geo, tunnelMat)
    this.group.add(tunnel)

    // Hanging lamps down the tunnel ceiling
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffaa55, emissive: 0xff8833, emissiveIntensity: 2.2, roughness: 0.5 })
    for (let o = from + 3; o <= to - 3; o += 5) {
      const idx = (mid + o + n) % n
      const cp = track.samples[idx]!
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), lampMat)
      lamp.position.set(cp.x, cp.y + ringR * 0.78, cp.z)
      this.group.add(lamp)
      this.caveLamps.push(lamp)
    }
  }

  // ── Directional chevron light-signs on sharp curves (not underwater) ─
  private buildChevrons(): void {
    const track = this.track
    const n = track.sampleCount
    // Real-world curve sign: black chevrons on a reflective yellow board
    const chevMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xf2c400, roughness: 0.5 })
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.45, metalness: 0.7 })

    // Build a reusable chevron board (3 arrows) pointing +X
    const makeBoard = (dir: number): THREE.Group => {
      const g = new THREE.Group()
      // yellow face, bare grey metal on the back and edges
      const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 0.2), [poleMat, poleMat, poleMat, poleMat, boardMat, poleMat])
      board.position.y = 3.4
      g.add(board)
      for (let a = 0; a < 3; a++) {
        const chev = new THREE.Group()
        for (const s of [-1, 1]) {
          const bar = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.42, 0.12), chevMat)
          bar.position.set(0, s * 0.5, 0.16)
          bar.rotation.z = s * dir * 0.7
          chev.add(bar)
        }
        chev.position.set(-1 + a * 1.0, 3.4, 0)
        g.add(chev)
      }
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), poleMat)
      pole.position.y = 1.7
      g.add(pole)
      return g
    }

    let lastPlaced = -999
    for (let i = 0; i < n; i += 4) {
      const zone = track.zoneOfSample(i)
      // the newer biomes carry their own signage
      if (!(zone === 'town' || zone === 'coast' || zone === 'causeway' || zone === 'canyon' || zone === 'space') || track.isGap(i)) continue
      // Curvature: angle between tangents a few samples apart
      const a = track.tangents[i]!
      const b = track.tangents[(i + 12) % n]!
      const cross = a.x * b.z - a.z * b.x
      const turn = Math.abs(cross)
      if (turn < 0.06 || i - lastPlaced < 24) continue
      lastPlaced = i
      const p = track.samples[i]!
      const right = this.rightAt(i)
      const side = cross > 0 ? 1 : -1 // outside of the curve
      // Face the chevrons at ONCOMING traffic (they used to face away from
      // the road, so drivers only saw the blank back), angled slightly in
      const t = track.tangents[i]!
      const fx = -t.x - right.x * side * 0.35, fz = -t.z - right.z * side * 0.35
      const yaw = Math.atan2(fx, fz)
      // Arrows point into the bend: local -X when dir = 1, +X when dir = -1
      const lx = Math.cos(yaw), lz = -Math.sin(yaw) // board's +X in world
      const inward = -(lx * right.x + lz * right.z) * side
      const dir = inward > 0 ? -1 : 1
      const pos = p.clone().addScaledVector(right, side * (track.width / 2 + 2.5))
      const board = makeBoard(dir)
      board.position.set(pos.x, p.y, pos.z)
      board.rotation.y = yaw
      this.group.add(board)
    }
  }

  /**
   * Clone + normalize a loaded GLB and place it clear of the road.
   *
   * Scaling to a target HEIGHT alone is dangerous: a short-wide source model
   * (e.g. a 9×3.6×9.7 building tile) explodes to ~175 units wide when forced
   * to height 70, covering the whole biome. So the scale is also capped by
   * `maxFootprint`, and when `roadPoint`+`outward`+`edgeClearance` are given
   * the model is positioned by its ACTUAL footprint edge so it can never
   * overlap the drivable surface.
   */
  /**
   * One cloned, tinted material per (source material, factor) pair. Cached so
   * repeated placements reuse a single variant instead of either compounding
   * the tint (the pure-black bug) or spawning a material per instance.
   */
  private readonly tintCache = new Map<string, THREE.Material>()
  private tintedMaterial(src: THREE.Material, factor: number): THREE.Material {
    const key = `${src.uuid}|${factor}`
    const hit = this.tintCache.get(key)
    if (hit) return hit
    const clone = src.clone()
    if ('color' in clone) (clone as THREE.MeshStandardMaterial).color.multiplyScalar(factor)
    this.tintCache.set(key, clone)
    return clone
  }

  private placeModel(
    template: THREE.Group,
    pos: THREE.Vector3,
    opts: {
      targetHeight?: number
      maxFootprint?: number
      outward?: THREE.Vector3
      edgeClearance?: number
      yaw?: number
      darken?: number
      surface?: boolean
      biome?: string
    } = {}
  ): THREE.Group {
    // Building pools hold many variants: place a random one (never clone the
    // pool itself — its userData holds the variant list).
    const variants = template.userData['variants'] as THREE.Group[] | undefined
    const base = variants ? variants[Math.floor(Math.random() * variants.length)]! : template
    const model = base.clone(true)
    model.position.set(0, 0, 0)
    model.rotation.set(0, 0, 0)
    model.scale.set(1, 1, 1)
    model.updateMatrixWorld(true)
    const size = new THREE.Vector3()
    new THREE.Box3().setFromObject(model).getSize(size)

    let scale = opts.targetHeight ? opts.targetHeight / Math.max(size.y, 0.001) : 1
    const footprint = Math.max(size.x, size.z, 0.001)
    if (opts.maxFootprint) scale = Math.min(scale, opts.maxFootprint / footprint)
    model.scale.setScalar(scale)
    model.updateMatrixWorld(true)

    // Ground the base AND recenter horizontally, so a model whose geometry is
    // offset from its own pivot (common in GLBs) still sits exactly where we
    // place it — otherwise the visible mesh drifts onto the road.
    const b2 = new THREE.Box3().setFromObject(model)
    const c2 = new THREE.Vector3()
    b2.getCenter(c2)
    const wrap = new THREE.Group()
    wrap.add(model)
    model.position.x -= c2.x
    model.position.z -= c2.z
    model.position.y -= b2.min.y

    // Footprint-aware placement: shift outward so the near edge clears the road
    const radius = (footprint * scale) / 2
    if (opts.outward && opts.edgeClearance !== undefined) {
      const p = pos.clone().addScaledVector(opts.outward, opts.edgeClearance + radius)
      wrap.position.copy(p)
    } else {
      wrap.position.copy(pos)
    }
    wrap.rotation.y = opts.yaw ?? Math.random() * Math.PI * 2

    // Never let a placed model overlap the road ANYWHERE on the track (a
    // cliff beside one bend can reach across another). Blocked placements
    // are dropped by batchPlacedModels().
    if (this.overlapsRoad(wrap)) {
      wrap.userData['blocked'] = true
      wrap.visible = false
    }

    if (opts.darken !== undefined) {
      // CRITICAL: `template.clone(true)` shares material instances by
      // reference, so mutating `color` here would re-darken the SAME material
      // once per placement — 0.85^50 drives a light building to pure black
      // (this was why the town rendered as flat black blocks). Instead map
      // each (material, factor) pair to a single cached, cloned variant.
      model.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return
        o.castShadow = false
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        const out = mats.map((m) => (m ? this.tintedMaterial(m, opts.darken!) : m))
        o.material = Array.isArray(o.material) ? out : out[0]!
      })
    }
    if (opts.biome !== 'space' && opts.biome !== 'underwater') naturalize(model, true)
    if (opts.biome) wrap.userData['biome'] = opts.biome
    if (opts.surface !== false) this.surfaceProps.push(wrap)
    this.placed.push(wrap)
    return wrap
  }

  private static readonly BIOME_ORDER = ['coast', 'underwater', 'space', 'canyon', 'volcano', 'desert', 'snow', 'sky', 'jungle', 'city']

  /** Zone label → coarse biome bucket used for culling. */
  static biomeOfZone(zone: string): string {
    if (zone === 'town' || zone === 'coast' || zone === 'causeway') return 'coast'
    if (zone === 'underwater' || zone === 'rampUp') return 'underwater'
    if (zone === 'flight1' || zone === 'space' || zone === 'flight2') return 'space'
    if (zone === 'saltflat') return 'desert'
    if (zone === 'roll' || zone === 'flight3') return 'sky'
    if (zone === 'volcano' || zone === 'desert' || zone === 'snow' || zone === 'sky' || zone === 'jungle' || zone === 'city') return zone
    return 'canyon'
  }

  /**
   * Show only the current biome's props (+ the two neighbours for the
   * horizon), hiding everything else — this is what stops one biome's
   * scenery bleeding into another. When submerged, hide ALL surface props.
   */
  /** World-space XZ bounds of each biome's road (for distance culling). */
  private biomeBounds: Map<string, [number, number, number, number]> | null = null
  private biomeDistance(b: string, cam: THREE.Vector3): number {
    if (!this.biomeBounds) {
      this.biomeBounds = new Map()
      const t = this.track
      for (let i = 0; i < t.sampleCount; i += 4) {
        const k = Scenery.biomeOfZone(t.zoneOfSample(i)), p = t.samples[i]!
        const e = this.biomeBounds.get(k) ?? [p.x, p.z, p.x, p.z]
        e[0] = Math.min(e[0], p.x); e[1] = Math.min(e[1], p.z); e[2] = Math.max(e[2], p.x); e[3] = Math.max(e[3], p.z)
        this.biomeBounds.set(k, e)
      }
    }
    const e = this.biomeBounds.get(b)
    if (!e) return 0
    return Math.hypot(Math.max(e[0] - cam.x, 0, cam.x - e[2]), Math.max(e[1] - cam.z, 0, cam.z - e[3]))
  }

  /** True on the frame the exclusive world (sea / moon) switched on or off. */
  exclusiveChanged = false

  updateVisibility(currentBiome: string, submerged: boolean, inSpace = false, spaceNear = false, cam?: THREE.Vector3): void {
    this.exclusiveChanged = false
    // Under the sea or up on the moon plateau, that world is shown ALONE:
    // nothing from the town, causeway or canyon can show through the water
    // or sit on the horizon in space.
    const want = submerged ? this.uwGroup : inSpace ? this.spaceGroup : null
    if (want !== this.exclusive) {
      this.exclusiveChanged = true
      for (const [o, v] of this.dryVisibility) o.visible = v
      this.dryVisibility.clear()
      this.exclusive = want
      if (want) {
        for (const o of this.group.children) {
          if (o === want || o.userData['keepVisible']) continue
          this.dryVisibility.set(o, o.visible)
          o.visible = false
        }
      }
    }
    if (want) return
    // The plateau, tanks and asteroid chunks hang in the sky: only show them
    // on the way up to space and in it, never over the canyon or the town
    this.spaceGroup.visible = spaceNear
    if (this.nightLights) this.nightLights.visible = this.nightLevel > 0.01
    for (const m of this.mountainMeshes) m.visible = !this.mountainsReplaced
    for (const b of this.balloons) b.visible = true
    for (const b of this.boats) b.visible = true

    const order = Scenery.BIOME_ORDER
    const ci = order.indexOf(currentBiome)
    for (const o of this.surfaceProps) {
      const b = o.userData['biome'] as string | undefined
      if (!b || ci < 0) { o.visible = true; continue } // untagged = backdrop, always on
      const bi = order.indexOf(b)
      let d = Math.abs(bi - ci)
      d = Math.min(d, order.length - d) // cyclic distance
      // anything within sight stays on, so tall buildings never pop into view
      o.visible = d <= 1 || (cam ? this.biomeDistance(b, cam) < 1150 : false)
    }
  }

  /**
   * Upgrade the scene with loaded GLB props once assets are ready. Called
   * once from Game after AssetLoader.loadAll(). Safe to no-op if a model
   * is missing (procedural stays).
   */
  applyModels(getModel: (name: string) => THREE.Group | null): void {
    const get = (name: string): THREE.Group | null => {
      const kind = USE_PROCEDURAL_BUILDINGS ? PROCEDURAL_FOR[name] : undefined
      if (kind === 'mid' || kind === 'tower') {
        // the scanned-quality city kit, when it loaded
        const real = ['dtLarge', 'dtMedium', 'dtSmall'].map((n) => getModel(n)).filter((m): m is THREE.Group => !!m)
        if (real.length) {
          const pool = real[0]!.clone()
          pool.userData['variants'] = kind === 'tower' ? real.slice(0, 2) : real
          return pool
        }
      }
      if (kind) return buildingPool(kind)
      if (name === 'cliff' || name === 'mountain' || name === 'rock') return this.texturedRock(name, getModel)
      if (USE_PROCEDURAL_TREES && name === 'palm') return treePool('palm')
      if (USE_PROCEDURAL_TREES && name === 'townTree') return treePool('broadleaf')
      return getModel(name)
    }
    if (this.modelsApplied) return
    this.modelsApplied = true
    const track = this.track
    const n = track.sampleCount

    const half = track.width / 2
    const outwardAt = (i: number, side: number) => this.rightAt(i).multiplyScalar(side)

    // Palms → real palm model (replace procedural). palmSpots.pos is already
    // an offset location beside the road, so place absolutely there.
    const palm = get('palm')
    if (palm && this.palmSpots.length) {
      for (const m of this.proceduralPalms) this.group.remove(m)
      for (let k = 0; k < this.palmSpots.length; k++) {
        const s = this.palmSpots[k]!
        this.group.add(this.placeModel(palm, new THREE.Vector3(s.pos.x, 0, s.pos.z), {
          targetHeight: 8 * s.scale, maxFootprint: 12, yaw: s.rot, darken: 1.0, biome: 'coast',
        }))
      }
    }

    // Street lamps along town + coast (alternating sides), just off the edge.
    // edgeClearance is measured from the road CENTRELINE, so it must be
    // half + margin or the lamp stands in the middle of the road.
    const lamp = get('streetlight')
    if (lamp) {
      let lampSide = 1
      for (let i = 0; i < n; i += 16) {
        const zone = track.zoneOfSample(i)
        if (!(zone === 'town' || zone === 'coast')) continue
        const p = track.samples[i]!
        if (p.y < -1) continue
        const yaw = Math.atan2(this.rightAt(i).x * -lampSide, this.rightAt(i).z * -lampSide)
        const placed = this.placeModel(lamp, new THREE.Vector3(p.x, p.y, p.z), {
          targetHeight: 7, maxFootprint: 3, yaw, outward: outwardAt(i, lampSide), edgeClearance: half + 2.5, biome: 'coast',
        })
        this.group.add(placed)
        if (!placed.userData['blocked']) this.recordLamp(placed.position, 7, outwardAt(i, -lampSide), p.y)
        lampSide *= -1
      }
    }

    // ── TOWN BIOME (biome 1): layered street composition ──────────────────
    this.dressTown(get, outwardAt)
    this.dressCoastWater(get, outwardAt)

    // Rocks scattered through the canyon (small, roadside)
    const rock = get('rock')
    if (rock) {
      for (let i = 0; i < n; i += 10) {
        if (track.zoneOfSample(i) !== 'canyon' || track.samples[i]!.y < -1 || Math.random() < 0.4) continue
        const side = Math.random() < 0.5 ? -1 : 1
        const p = track.samples[i]!
        this.group.add(this.placeModel(rock, new THREE.Vector3(p.x, p.y, p.z), {
          targetHeight: 2 + Math.random() * 5, maxFootprint: 8, darken: 0.75,
          outward: outwardAt(i, side), edgeClearance: half + 4 + Math.random() * 6, biome: 'canyon',
        }))
      }
    }

    // Concrete crash barriers lining the launch ramp (giant traffic cones
    // used to stand here and read as white tents)
    this.buildRampBarriers()

    // ── Distant mountains: real cliff/mountain models on the horizon ──
    const cliff = get('cliff')
    const mountain = get('mountain')
    if (cliff || mountain) {
      for (const m of this.mountainMeshes) m.visible = false
      this.mountainsReplaced = true
      const ringSpots: [number, number, number][] = [
        [-640, 140, 140], [-440, 760, 120], [160, 900, 110],
        [790, 640, 100], [380, 900, 110], [-1080, 260, 150],
      ]
      for (const [x, z, h] of ringSpots) {
        const tmpl = (Math.random() < 0.5 && cliff) ? cliff : (mountain || cliff)!
        this.group.add(this.placeModel(tmpl, new THREE.Vector3(x, -3, z), {
          targetHeight: h, maxFootprint: 150, yaw: Math.random() * Math.PI * 2, darken: 0.9,
        }))
      }
    }

    // ── Canyon walls: cliff models framing the corridor, well clear of road ──
    if (cliff) {
      for (let i = 0; i < n; i += 12) {
        if (track.zoneOfSample(i) !== 'canyon' || track.samples[i]!.y < -1) continue
        for (const side of [-1, 1]) {
          if (Math.random() < 0.25) continue
          const p = track.samples[i]!
          this.group.add(this.placeModel(cliff, new THREE.Vector3(p.x, p.y - 3, p.z), {
            targetHeight: 24 + Math.random() * 30, maxFootprint: 48,
            outward: outwardAt(i, side), edgeClearance: half + 12 + Math.random() * 24,
            yaw: Math.random() * Math.PI * 2, biome: 'canyon',
          }))
        }
      }
    }

    // ── Space props. 'satellite' is a ringed-PLANET → belongs in the SKY as
    // distant backdrop (not a floating road prop). 'rocket' is grounded on
    // the moon plateau beside the road. ('station' is a rigged astronaut —
    // excluded.) ──
    // The cartoon rocket and ringed-planet models don't fit the realistic
    // look; the moon base uses the generated tanks and gantries instead.
    const satellite: THREE.Group | null = null
    const rocket: THREE.Group | null = null

    // Rockets grounded on the plateau (plateau surface is ~1.6 below the road)
    if (rocket) {
      for (let i = 0; i < n; i += 16) {
        if (track.zoneOfSample(i) !== 'space' || Math.random() < 0.4) continue
        const side = Math.random() < 0.5 ? -1 : 1
        const p = track.samples[i]!
        this.group.add(this.placeModel(rocket, new THREE.Vector3(p.x, p.y - 1.6, p.z), {
          targetHeight: 16 + Math.random() * 20, maxFootprint: 22,
          outward: outwardAt(i, side), edgeClearance: half + 14 + Math.random() * 30,
          yaw: Math.random() * Math.PI * 2, biome: 'space',
        }))
      }
    }

    // Planets floating in the space sky: a few big ones, high and far, as a
    // backdrop — tagged 'space' so they only appear in the space biome.
    if (satellite) {
      const spaceSamples: THREE.Vector3[] = []
      for (let i = 0; i < n; i++) if (track.zoneOfSample(i) === 'space') spaceSamples.push(track.samples[i]!)
      if (spaceSamples.length) {
        const c = new THREE.Vector3()
        for (const s of spaceSamples) c.add(s)
        c.multiplyScalar(1 / spaceSamples.length)
        const planetSpots: [number, number, number, number][] = [
          [c.x - 180, c.y + 120, c.z - 120, 90],
          [c.x + 200, c.y + 150, c.z + 60, 70],
          [c.x + 40, c.y + 200, c.z - 220, 60],
        ]
        for (const [px, py, pz, ph] of planetSpots) {
          this.group.add(this.placeModel(satellite, new THREE.Vector3(px, py, pz), {
            targetHeight: ph, maxFootprint: ph * 1.6, biome: 'space',
          }))
        }
      }
    }

    this.batchPlacedModels()
    this.buildNightLights()
  }

  private roadHash: Map<string, number[]> | null = null

  /**
   * True if the object's bounding box comes within the road edge (+1.5 m)
   * of any track sample at a height where it would hit a car.
   */
  /** Inside the open arena round the vertical loop (kept clear for the view)? */
  private inLoopArena(x: number, z: number, r = 0): boolean {
    for (const L of LOOPS) {
      const cx = L.center[0] + L.lateral[0] * L.shift * 0.5, cz = L.center[2] + L.lateral[1] * L.shift * 0.5
      if ((x - cx) ** 2 + (z - cz) ** 2 < (80 + r) ** 2) return true
    }
    return false
  }

  private overlapsRoad(obj: THREE.Object3D): boolean {
    const t = this.track
    const CELL = 25
    if (!this.roadHash) {
      this.roadHash = new Map()
      t.samples.forEach((p, i) => {
        if (t.isGap(i)) return
        const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
        const l = this.roadHash!.get(k)
        if (l) l.push(i); else this.roadHash!.set(k, [i])
      })
    }
    obj.updateMatrixWorld(true)
    const full = new THREE.Box3().setFromObject(obj)
    if (full.isEmpty()) return false
    {
      const c = full.getCenter(new THREE.Vector3())
      if (this.inLoopArena(c.x, c.z, Math.max(full.max.x - full.min.x, full.max.z - full.min.z) / 2)) return true
    }
    // Footprint of the part a car could hit: the lowest 4.5 m of the model.
    // (A street lamp's arm may hang over the road; its post may not.)
    const box = new THREE.Box3()
    const v = new THREE.Vector3()
    const cutoff = full.min.y + 4.5
    obj.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const pos = m.geometry.getAttribute('position')
      const step = Math.max(1, Math.floor(pos.count / 1500))
      for (let k = 0; k < pos.count; k += step) {
        v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld)
        if (v.y <= cutoff) box.expandByPoint(v)
      }
    })
    if (box.isEmpty()) return false
    const clear = t.width / 2 + 0.6
    const x0 = Math.floor((box.min.x - clear) / CELL), x1 = Math.floor((box.max.x + clear) / CELL)
    const z0 = Math.floor((box.min.z - clear) / CELL), z1 = Math.floor((box.max.z + clear) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (const i of this.roadHash.get(`${cx},${cz}`) ?? []) {
          const p = t.samples[i]!
          // Where the road runs ABOVE the model's base (an elevated section),
          // its upper floors could be in the road's way: test the full model
          const b = p.y > full.min.y + 3.5 ? full : box
          if (b.max.y < p.y - 0.5 || b.min.y > p.y + 5) continue // well below / above the car
          const dx = Math.max(b.min.x - p.x, 0, p.x - b.max.x)
          const dz = Math.max(b.min.z - p.z, 0, p.z - b.max.z)
          if (dx * dx + dz * dz < clear * clear) return true
        }
      }
    }
    return false
  }

  private rockTemplates = new Map<string, THREE.Group | null>()
  private rockMaterial: THREE.MeshStandardMaterial | null = null

  /**
   * Cliff / mountain / rock models re-skinned with a real rock texture
   * (sandstone-tinted). Their UVs are generated in world space at batching
   * time (material.userData.worldUV = metres per texture tile).
   */
  private texturedRock(name: string, getModel: (n: string) => THREE.Group | null): THREE.Group | null {
    if (this.rockTemplates.has(name)) return this.rockTemplates.get(name)!
    const src = getModel(name)
    if (!src) { this.rockTemplates.set(name, null); return null }
    if (!this.rockMaterial) {
      const r = tiled(rockSet(), 1, 1)
      this.rockMaterial = new THREE.MeshStandardMaterial({
        color: 0xa58466, map: r.map, normalMap: r.normalMap, normalScale: new THREE.Vector2(1.4, 1.4),
        roughness: 1, flatShading: true,
      })
      this.rockMaterial.userData['worldUV'] = 9
    }
    const t = src.clone(true)
    t.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      m.material = this.rockMaterial!
      m.geometry = dropFloatingPieces(m.geometry)
    })
    this.rockTemplates.set(name, t)
    return t
  }

  /**
   * Remove instances of generated scenery (rocks, spires, mesas, boulders)
   * that would sit on the road anywhere on the track — the road doubles back
   * on itself, so something placed beside one bend can land on another.
   */
  private cullInstancesNearRoad(): void {
    const t = this.track
    const clear = t.width / 2 + 0.6
    const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    this.group.traverse((o) => {
      const mesh = o as THREE.InstancedMesh
      if (!mesh.isInstancedMesh) return
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const bb = mesh.geometry.boundingBox!
      const r0 = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x), Math.abs(bb.min.z), Math.abs(bb.max.z))
      let culled = 0
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, m4)
        m4.decompose(pos, q, sc)
        const r = r0 * Math.max(sc.x, sc.z)
        // Tilted instances (rocks): use the full rotated extent for height
        const tilted = Math.abs(q.x) > 0.02 || Math.abs(q.z) > 0.02
        const reach = Math.max(r0, Math.abs(bb.min.y), Math.abs(bb.max.y)) * Math.max(sc.x, sc.y, sc.z)
        const y0 = tilted ? pos.y - reach : pos.y + bb.min.y * sc.y
        const y1 = tilted ? pos.y + reach : pos.y + bb.max.y * sc.y
        let hit = this.inLoopArena(pos.x, pos.z, r)
        for (let i = 0; i < t.sampleCount && !hit; i += 2) {
          if (t.isGap(i)) continue
          const p = t.samples[i]!
          // Entirely under the road surface (supports, embankments, pillars) or
          // well above it: not in the way
          if (y1 < p.y + 0.3 || y0 > p.y + 5) continue
          const dx = p.x - pos.x, dz = p.z - pos.z
          const lim = clear + r * 0.8
          if (dx * dx + dz * dz < lim * lim) hit = true
        }
        if (hit) { mesh.setMatrixAt(k, zero); culled++ }
      }
      if (culled) { mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere() }
    })
    // Single canyon rock pieces (mesas, cave hills): hide any that block the road
    for (const o of this.group.children) {
      const m = o as THREE.Mesh
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) continue
      if (!(m.material as THREE.Material).userData?.['canyonRock']) continue
      if (this.overlapsRoad(m)) m.visible = false
      else {
        const b = new THREE.Box3().setFromObject(m), c = b.getCenter(new THREE.Vector3())
        if (this.inLoopArena(c.x, c.z, (b.max.x - b.min.x) / 2)) m.visible = false
      }
    }
  }

  /** Remember a lamp: base position, height, direction toward the road. */
  private recordLamp(base: THREE.Vector3, height: number, inward: THREE.Vector3, roadY: number, armReach = 1.1): void {
    const head = base.clone().addScaledVector(inward, armReach)
    head.y = base.y + height * 0.96
    const ground = base.clone().addScaledVector(inward, armReach + 1.8)
    ground.y = roadY + 0.06
    this.lamps.push({ head, ground })
  }

  /**
   * Night lighting without hundreds of real lights: a glowing bulb on each
   * lamp (bloom does the halo) plus an additive pool of warm light on the
   * road below it. Two draw calls in total; hidden by day.
   */
  private buildNightLights(): void {
    if (!this.lamps.length) return
    const g = new THREE.Group()
    const bulbGeo = new THREE.SphereGeometry(0.22, 10, 8)
    this.nightBulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 0 })
    const bulbs = new THREE.InstancedMesh(bulbGeo, this.nightBulbMat, this.lamps.length)
    const poolGeo = new THREE.PlaneGeometry(16, 16)
    poolGeo.rotateX(-Math.PI / 2)
    this.nightPoolMat = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(), color: 0xffc98a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    })
    const pools = new THREE.InstancedMesh(poolGeo, this.nightPoolMat, this.lamps.length)
    const d = new THREE.Object3D()
    this.lamps.forEach((l, i) => {
      d.position.copy(l.head); d.updateMatrix(); bulbs.setMatrixAt(i, d.matrix)
      d.position.copy(l.ground); d.updateMatrix(); pools.setMatrixAt(i, d.matrix)
    })
    bulbs.computeBoundingSphere()
    pools.computeBoundingSphere()
    pools.renderOrder = 2
    g.add(bulbs, pools)
    g.visible = false // shown by updateVisibility() only at night
    this.group.add(g)
    this.nightLights = g
    this.setNight(this.nightLevel)
  }

  /** 0 = day, 1 = night: lamps, light pools, windows. */
  setNight(level: number): void {
    this.nightLevel = level
    setBuildingNightLights(level)
    if (this.nightBulbMat) this.nightBulbMat.emissiveIntensity = level * 9
    if (this.nightPoolMat) this.nightPoolMat.opacity = level * 0.55
    if (this.nightLights) this.nightLights.visible = level > 0.01
    // The lighthouse beam is a night thing (it read as a glass cone by day)
    if (this.beacon) this.beacon.visible = level > 0.3
  }

  /**
   * Static batching. ~480 placed models (each several meshes) cost 100–500
   * draw calls a frame, twice over with the shadow pass. Merge them into one
   * mesh per (biome, material look, shadow flags, 400 m grid cell): pixels
   * are identical, culling still works per cell and per biome, and draw
   * calls drop to a few dozen. Materials that look the same (free models
   * mostly use flat colors) are shared across models via materialSignature().
   */
  private batchPlacedModels(): void {
    const CELL = 400
    const shared = new Map<string, THREE.Material>()
    this.group.updateMatrixWorld(true)
    const surfaceSet = new Set(this.surfaceProps)
    type Bucket = { mat: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean; biome: string; surface: boolean }
    const buckets = new Map<string, Bucket>()
    const merged = new Set<THREE.Object3D>()

    for (const wrap of this.placed) {
      if (wrap.parent !== this.group) continue
      if (wrap.userData['blocked']) { merged.add(wrap); continue }
      let ok = true
      wrap.traverse((o) => {
        const m = o as THREE.Mesh
        if ((o as THREE.SkinnedMesh).isSkinnedMesh || (o as THREE.InstancedMesh).isInstancedMesh ||
          (o as THREE.Light).isLight || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite ||
          (m.isMesh && Array.isArray(m.material))) ok = false
      })
      if (!ok) continue
      const biome = (wrap.userData['biome'] as string | undefined) ?? ''
      const surface = surfaceSet.has(wrap)
      const cell = `${Math.floor(wrap.position.x / CELL)},${Math.floor(wrap.position.z / CELL)}`
      wrap.traverse((o) => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh || !mesh.visible) return
        const sig = materialSignature(mesh.material as THREE.Material)
        let mat = shared.get(sig)
        if (!mat) { mat = mesh.material as THREE.Material; shared.set(sig, mat) }
        const key = `${biome}|${surface}|${sig}|${mesh.castShadow}|${mesh.receiveShadow}|${cell}`
        const geo = toPlainGeometry(mesh.geometry, mesh.matrixWorld, (mat as THREE.MeshStandardMaterial).vertexColors === true,
          mat.userData['worldUV'] as number | undefined)
        const b = buckets.get(key)
        if (b) b.geos.push(geo)
        else buckets.set(key, { mat, geos: [geo], cast: mesh.castShadow, recv: mesh.receiveShadow, biome, surface })
      })
      merged.add(wrap)
    }

    for (const b of buckets.values()) {
      const geo = b.geos.length === 1 ? b.geos[0]! : mergeGeometries(b.geos, false)
      if (!geo) continue
      const mesh = new THREE.Mesh(geo, b.mat)
      mesh.castShadow = b.cast
      mesh.receiveShadow = b.recv
      if (b.biome) mesh.userData['biome'] = b.biome
      this.group.add(mesh)
      if (b.surface) this.surfaceProps.push(mesh)
    }
    for (const w of merged) this.group.remove(w)
    this.surfaceProps = this.surfaceProps.filter((o) => !merged.has(o))
    this.placed = []
  }

  // ── Start gate ───────────────────────────────────────────────────────
  /**
   * Start/finish banner, printed like a real event gantry: white vinyl,
   * a chequered strip top and bottom, the name in bold navy with a red
   * accent (replaces the neon-purple retro sign).
   */
  private drawBanner(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#f4f4f1'
    ctx.fillRect(0, 0, w, h)
    const cell = h * 0.1
    for (let x = 0; x * cell < w; x++) {
      for (const [y0, odd] of [[0, 0], [h - cell, 1]] as const) {
        ctx.fillStyle = (x + odd) % 2 ? '#111' : '#f4f4f1'
        ctx.fillRect(x * cell, y0, cell, cell)
      }
    }
    // Measure both words and centre them together with a gap
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    const f1 = `italic 800 ${h * 0.56}px "Barlow Condensed", Arial, sans-serif`
    const f2 = `italic 700 ${h * 0.5}px "Barlow Condensed", Arial, sans-serif`
    ctx.font = f1
    const w1 = ctx.measureText('HORIZON').width
    ctx.font = f2
    const w2 = ctx.measureText('DRIVE').width
    const gap = h * 0.25
    const scale = Math.min(1, (w * 0.9) / (w1 + gap + w2))
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.scale(scale, scale)
    const x0 = -(w1 + gap + w2) / 2
    ctx.font = f1
    ctx.fillStyle = '#132a4f'
    ctx.fillText('HORIZON', x0, h * 0.02)
    ctx.font = f2
    ctx.fillStyle = '#c8202e'
    ctx.fillText('DRIVE', x0 + w1 + gap, h * 0.03)
    ctx.restore()
  }


  /**
   * Glowing neon guide-posts marching down both roadsides through the land
   * biomes. They reinforce the racing line (you can read the route from the
   * posts alone) and add near/mid depth layering so the world guides the eye —
   * the single biggest readability win. Alternating cyan/magenta, outside the
   * drivable surface. Hidden underwater with the rest of the surface props.
   */
  private buildRoadsidePosts(): void {
    const track = this.track
    const n = track.sampleCount
    // Real-world delineator posts: white plastic post, black band, amber
    // retro-reflector facing traffic. Instanced — three draw calls total.
    const postMat = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.55 })
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6 })
    const reflMat = new THREE.MeshStandardMaterial({
      color: 0xffa21f, roughness: 0.25, emissive: 0xff8a00, emissiveIntensity: 0.6,
    })
    const postGeo = new THREE.BoxGeometry(0.12, 1.1, 0.12)
    postGeo.translate(0, 0.55, 0)
    const bandGeo = new THREE.BoxGeometry(0.125, 0.22, 0.125)
    bandGeo.translate(0, 0.86, 0)
    const reflGeo = new THREE.BoxGeometry(0.13, 0.1, 0.13)
    reflGeo.translate(0, 1.0, 0)
    const landZones = new Set(['town', 'coast', 'causeway', 'canyon'])
    const half = track.width / 2 + 1.4

    const spots: THREE.Matrix4[] = []
    const dummy = new THREE.Object3D()
    for (let i = 0; i < n; i += 6) {
      if (!landZones.has(track.zoneOfSample(i))) continue
      const p = track.samples[i]!
      const right = this.rightAt(i)
      for (const s of [-1, 1] as const) {
        const pos = p.clone().addScaledVector(right, s * half)
        dummy.position.set(pos.x, p.y, pos.z)
        dummy.rotation.set(0, Math.atan2(right.x, right.z), 0)
        dummy.updateMatrix()
        spots.push(dummy.matrix.clone())
      }
    }
    for (const [geo, mat] of [[postGeo, postMat], [bandGeo, bandMat], [reflGeo, reflMat]] as const) {
      const mesh = new THREE.InstancedMesh(geo, mat, spots.length)
      spots.forEach((m, i) => mesh.setMatrixAt(i, m))
      mesh.castShadow = mat === postMat
      this.group.add(mesh)
      this.surfaceProps.push(mesh)
    }
  }

  /**
   * TOWN BIOME (biome 1) — real-model street dressing in four depth layers, so
   * the drive reads as a lived-in coastal main street instead of scattered
   * boxes:
   *
   *   L1 near  (edge+2..6)   bench, crate, fence, traffic light, street sign
   *   L2 front (edge+9..16)  shop / store / diner / kiosk storefront row
   *   L3 mid   (edge+22..44) awning blocks, billboards, vans, trees
   *   L4 far   (edge+55..120) tower skyline silhouette
   *
   * Every layer is gated on `zone === 'town'`, keeps `edgeClearance` measured
   * from the road centreline, and falls back silently if a model is missing.
   */
  private dressTown(
    get: (name: string) => THREE.Group | null,
    outwardAt: (i: number, side: number) => THREE.Vector3
  ): void {
    const track = this.track
    const n = track.sampleCount
    const half = track.width / 2
    const isTown = (i: number) => track.zoneOfSample(i) === 'town' && track.samples[i]!.y > -1
    const yawFor = (i: number, side: number) =>
      Math.atan2(this.rightAt(i).x * -side, this.rightAt(i).z * -side)
    const rnd = (a: number, b: number) => a + Math.random() * (b - a)

    // Pull every town template once; nulls are tolerated throughout.
    const M = {
      shop: get('townShop'), store: get('townStore'), diner: get('townDiner'),
      kiosk: get('townKiosk'), tower2: get('townTower2'), awning: get('townAwning'),
      // The billboard GLB is a bare brown slab with no ad face: build a real one
      billboard: this.makeBillboard(), sign: null, traffic: get('townTraffic'),
      bench: get('townBench'), fence: get('townFence'), crate: get('townCrate'),
      van: get('townVan'), lamp2: get('townLamp2'), tree: get('townTree'),
      building: get('building'), skyscraper: get('skyscraper'), house: get('house'),
    }
    // Real storefronts replace the box placeholders (only if we actually got
    // usable town models — otherwise keep the fallback town standing).
    const haveTownModels = !!(M.shop || M.store || M.diner || M.kiosk)
    if (haveTownModels) {
      for (const h of this.proceduralHouses) this.group.remove(h)
      this.proceduralHouses.length = 0
    }

    const pick = (...c: (THREE.Group | null)[]): THREE.Group | null => {
      const ok = c.filter(Boolean) as THREE.Group[]
      return ok.length ? ok[Math.floor(Math.random() * ok.length)]! : null
    }
    const put = (
      tmpl: THREE.Group | null, i: number, side: number,
      o: { h: number; fp: number; clr: number; yawJitter?: number }
    ) => {
      if (!tmpl) return
      const p = track.samples[i]!
      const placed = this.placeModel(tmpl, new THREE.Vector3(p.x, p.y, p.z), {
        targetHeight: o.h,
        maxFootprint: o.fp,
        outward: outwardAt(i, side),
        edgeClearance: half + o.clr,
        yaw: yawFor(i, side) + (o.yawJitter ? rnd(-o.yawJitter, o.yawJitter) : 0),
        darken: 1.0,
        biome: 'coast',
      })
      this.group.add(placed)
      if (tmpl === M.lamp2 && !placed.userData['blocked']) this.recordLamp(placed.position, o.h, outwardAt(i, -side), p.y)
    }

    // ── L4 FAR: tower skyline. Sparse + tall = a silhouette behind everything.
    for (let i = 0; i < n; i += 22) {
      if (!isTown(i)) continue
      for (const side of [-1, 1] as const) {
        if (Math.random() < 0.4) continue
        put(pick(M.tower2, M.skyscraper, M.building), i, side, {
          h: rnd(46, 104), fp: 34, clr: rnd(55, 120), yawJitter: 0.5,
        })
      }
    }

    // ── L3 MID: bulk blocks + billboards + parked vans + trees.
    for (let i = 0; i < n; i += 12) {
      if (!isTown(i)) continue
      for (const side of [-1, 1] as const) {
        if (Math.random() < 0.4) continue
        put(pick(M.awning, M.building, M.house), i, side, {
          h: rnd(12, 26), fp: 24, clr: rnd(22, 44), yawJitter: 0.35,
        })
      }
      if (Math.random() < 0.28) {
        put(M.billboard, i, Math.random() < 0.5 ? -1 : 1, { h: rnd(9, 14), fp: 12, clr: rnd(16, 26) })
      }
      if (Math.random() < 0.22) {
        put(M.tree, i, Math.random() < 0.5 ? -1 : 1, { h: rnd(6, 11), fp: 7, clr: rnd(18, 34), yawJitter: 3 })
      }
    }

    // ── L2 FRONT: the storefront row — the layer the player actually reads.
    for (let i = 0; i < n; i += 9) {
      if (!isTown(i)) continue
      for (const side of [-1, 1] as const) {
        if (Math.random() < 0.25) continue
        put(pick(M.shop, M.store, M.diner, M.kiosk), i, side, {
          h: rnd(7, 13), fp: 16, clr: rnd(9, 16), yawJitter: 0.12,
        })
      }
    }

    // ── L1 NEAR: roadside clutter that streaks past the camera at speed.
    let flip = 1
    for (let i = 0; i < n; i += 7) {
      if (!isTown(i)) continue
      const r = Math.random()
      if (r < 0.3) put(M.bench, i, flip, { h: 1.3, fp: 3, clr: rnd(2.2, 4) })
      else if (r < 0.5) put(M.crate, i, flip, { h: rnd(0.9, 1.6), fp: 2.4, clr: rnd(2.2, 4.5), yawJitter: 3 })
      else if (r < 0.68) put(M.sign, i, flip, { h: rnd(2.6, 3.6), fp: 2.5, clr: rnd(2, 3.4) })
      else if (r < 0.8) put(M.traffic, i, flip, { h: rnd(5, 6.5), fp: 3, clr: rnd(2, 3.2) })
      else if (r < 0.9) put(M.van, i, flip, { h: rnd(2.2, 3), fp: 6, clr: rnd(3.5, 6) })
      else put(M.lamp2, i, flip, { h: rnd(5, 7), fp: 3, clr: rnd(2.2, 3.6) })
      flip *= -1
    }

    // Fence runs filling gaps between buildings on straights.
    for (let i = 0; i < n; i += 8) {
      if (!isTown(i) || Math.random() < 0.6) continue
      put(M.fence, i, Math.random() < 0.5 ? -1 : 1, { h: rnd(1.4, 2.1), fp: 6, clr: rnd(6, 10) })
    }
  }

  /** Pier decking + moored boats on the ocean side of the coast run. */
  private dressCoastWater(
    get: (name: string) => THREE.Group | null,
    outwardAt: (i: number, side: number) => THREE.Vector3
  ): void {
    const track = this.track
    const n = track.sampleCount
    const half = track.width / 2
    const pier = get('townPier')
    const boat = get('townBoat')
    if (!pier && !boat) return
    for (let i = 0; i < n; i += 26) {
      const zone = track.zoneOfSample(i)
      if (zone !== 'coast' && zone !== 'town') continue
      const p = track.samples[i]!
      if (p.y < -1 || Math.random() < 0.55) continue
      const side = 1 // ocean side
      if (pier) {
        this.group.add(this.placeModel(pier, new THREE.Vector3(p.x, 0.2, p.z), {
          targetHeight: 4, maxFootprint: 40, outward: outwardAt(i, side),
          edgeClearance: half + 40 + Math.random() * 30,
          yaw: Math.atan2(this.rightAt(i).x * -side, this.rightAt(i).z * -side),
          darken: 1.0, biome: 'coast',
        }))
      }
      if (boat && Math.random() < 0.6) {
        this.group.add(this.placeModel(boat, new THREE.Vector3(p.x, 0.4, p.z), {
          targetHeight: 5, maxFootprint: 12, outward: outwardAt(i, side),
          edgeClearance: half + 78 + Math.random() * 60,
          yaw: Math.random() * Math.PI * 2, darken: 1.0, biome: 'coast',
        }))
      }
    }
  }

  private buildStartGate(): void {
    const track = this.track
    const canvas = document.createElement('canvas')
    canvas.width = 1024
    canvas.height = 200
    const ctx = canvas.getContext('2d')!
    this.drawBanner(ctx, canvas.width, canvas.height)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace

    signFontsReady().then(() => {
      this.drawBanner(ctx, canvas.width, canvas.height)
      tex.needsUpdate = true
    })

    const gate = new THREE.Group()
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 5.8),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false })
    )
    banner.position.y = 11.2
    gate.add(banner)

    // Two glowing pylons either side of the road holding the banner up, so it
    // reads as a start arch you drive under (not a floating sign). Posts sit
    // outside the drivable surface.
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8d9398, roughness: 0.4, metalness: 0.8 })
    const half = track.width / 2 + 2.5
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, 14, 10), postMat)
      post.position.set(s * half, 7, 0)
      post.castShadow = true
      gate.add(post)
    }
    // Neon crossbeam under the banner
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(half * 2, 0.5, 0.5),
      postMat
    )
    beam.position.y = 8.4
    gate.add(beam)

    const p = track.spawnPosition
    const t = track.tangents[0]!
    // Arch stands right over the checkered start line (a couple of metres
    // behind it, so you pass under the banner before crossing the line)
    gate.position.set(p.x - t.x * 2, 0, p.z - t.z * 2)
    gate.rotation.y = Math.atan2(t.x, t.z) + Math.PI
    this.group.add(gate)
  }

  // ── Camera flashes (paparazzi bursts at checkpoints/finish) ──────────
  private buildCameraFlashes(): void {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 64
    const ctx = c.getContext('2d')!
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.8)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    const tex = new THREE.CanvasTexture(c)

    const POOL = 10
    for (let i = 0; i < POOL; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.setScalar(5)
      sprite.visible = false
      this.group.add(sprite)
      this.flashSprites.push(sprite)
      this.flashTimes.push({ t: Infinity, spikes: [] })
    }
  }

  /**
   * Earth prominence: hidden on the ground and underwater, fading in as
   * the sky turns to space.
   */
  setSpaceFactor(spaceFactor: number, underwaterFactor: number): void {
    if (this.earth) {
      const mat = this.earth.material as THREE.MeshBasicMaterial
      // Only in space: a ghostly Earth hanging in a blue daytime sky looked wrong
      mat.opacity = THREE.MathUtils.smoothstep(spaceFactor, 0.35, 0.8)
      this.earth.visible = mat.opacity > 0.02
    }
  }


  /** Fire a paparazzi flash burst around a world position. */
  flashBurst(center: THREE.Vector3): void {
    for (let i = 0; i < this.flashSprites.length; i++) {
      const sprite = this.flashSprites[i]!
      sprite.position.set(
        center.x + (Math.random() - 0.5) * 22,
        center.y + 2 + Math.random() * 7,
        center.z + (Math.random() - 0.5) * 22
      )
      sprite.visible = true
      const t0 = Math.random() * 0.35
      this.flashTimes[i] = { t: 0, spikes: [t0, t0 + 0.25 + Math.random() * 0.4] }
    }
  }

  // ── Per-frame animation ──────────────────────────────────────────────
  /** Sunbeams, caustics, kelp and drifting particles under the sea. */
  updateUnderwater(time: number, camera: THREE.Camera): void {
    this.underwater?.update(time, camera)
  }

  update(time: number, dt = 0.016): void {
    this.countryside.update(time)
    this.spaceExtras?.update(time)
    for (const b of this.balloons) {
      const phase = b.userData['phase'] as number
      const baseY = b.userData['baseY'] as number
      b.position.y = baseY + Math.sin(time * 0.25 + phase) * 3
    }
    for (let i = 0; i < this.boats.length; i++) {
      const boat = this.boats[i]!
      boat.rotation.z = Math.sin(time * 0.6 + i * 1.7) * 0.03
      boat.position.y = Math.sin(time * 0.8 + i * 2.3) * 0.1
    }

    // Bubbles rise
    if (this.bubbles && this.bubbleVel) {
      const attr = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const count = this.bubbleVel.length
      for (let i = 0; i < count; i++) {
        arr[i * 3 + 1]! += this.bubbleVel[i]! * dt
        if (arr[i * 3 + 1]! > this.bubbleBounds.maxY) {
          arr[i * 3 + 1] = this.bubbleBounds.minY
        }
      }
      attr.needsUpdate = true
    }

    // Fish wander
    if (this.fish && this.fishData) {
      const attr = this.fish.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const b = this.fishBounds
      const count = this.fishData.length / 2
      for (let i = 0; i < count; i++) {
        const phase = this.fishData[i * 2]!
        const speed = this.fishData[i * 2 + 1]!
        arr[i * 3]! += Math.cos(phase) * speed * dt
        arr[i * 3 + 1]! += Math.sin(time * 1.4 + phase * 3) * 0.02
        arr[i * 3 + 2]! += Math.sin(phase) * speed * dt + Math.sin(time * 2 + phase) * 0.04
        // Wrap inside the underwater box
        if (arr[i * 3]! < b.min.x) arr[i * 3] = b.max.x
        if (arr[i * 3]! > b.max.x) arr[i * 3] = b.min.x
        if (arr[i * 3 + 2]! < b.min.z) arr[i * 3 + 2] = b.max.z
        if (arr[i * 3 + 2]! > b.max.z) arr[i * 3 + 2] = b.min.z
      }
      attr.needsUpdate = true
    }

    // Shark patrol: wide ellipse crossing over the road
    if (this.shark && this.sharkTail) {
      const w = time * 0.11
      const px = this.sharkCenter.x + Math.cos(w) * 85
      const pz = this.sharkCenter.z + Math.sin(w) * 48
      const py = this.sharkCenter.y + Math.sin(time * 0.4) * 2.5
      // Velocity direction for heading
      const vx = -Math.sin(w) * 85
      const vz = Math.cos(w) * 48
      this.shark.position.set(px, py, pz)
      this.shark.rotation.y = Math.atan2(vx, vz) + Math.PI
      this.sharkTail.rotation.y = Math.sin(time * 5.5) * 0.45
    }

    // Water + caustic scrolling
    for (const sh of this.oceanShaders) sh.uniforms['uTime']!.value = time % 3600
    this.vegetation?.update(time)
    // (underwater animation runs in updateUnderwater, which needs the camera)

    // Landmarks
    if (this.ferris) this.ferris.rotation.z = time * 0.12
    if (this.beacon) this.beacon.rotation.y = time * 0.7
    if (this.satLight) {
      const m = this.satLight.material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 1 + Math.max(0, Math.sin(time * 3)) * 2
    }
    // Comms-mast beacons: a short blink every 1.5 s
    if (this.station) this.station.rotateZ(dt * 0.05)
    for (const tx of this.scrollTex) { if (tx.wrapS === THREE.RepeatWrapping) tx.offset.x = (tx.offset.x - dt * 1.4) % 1; else tx.offset.y = (tx.offset.y - dt * 1.2) % 1 }
    // Boost pads pulse
    const pulse = 0.75 + 0.25 * Math.sin(time * 6)
    for (const m of this.padMats) m.color.setScalar(pulse)
    const blink = (time % 1.5) < 0.18
    for (const b of this.spaceBeacons) (b.material as THREE.MeshStandardMaterial).emissiveIntensity = blink ? 4 : 0.2

    // Meteor streaks drift and respawn
    if (this.meteors && this.meteorVel) {
      const attr = this.meteors.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const o = this.meteors.userData['origin'] as { cx: number; cy: number; cz: number }
      for (let i = 0; i < this.meteorVel.length / 3; i++) {
        arr[i * 3]! += this.meteorVel[i * 3]! * dt
        arr[i * 3 + 1]! += this.meteorVel[i * 3 + 1]! * dt
        arr[i * 3 + 2]! += this.meteorVel[i * 3 + 2]! * dt
        if (arr[i * 3 + 1]! < o.cy - 160) {
          arr[i * 3] = o.cx + (Math.random() - 0.5) * 900
          arr[i * 3 + 1] = o.cy + 160
          arr[i * 3 + 2] = o.cz + (Math.random() - 0.5) * 900
        }
      }
      attr.needsUpdate = true
    }

    // Cave lamps flicker subtly
    for (let i = 0; i < this.caveLamps.length; i++) {
      const m = this.caveLamps[i]!.material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 2 + Math.sin(time * 6 + i) * 0.5
    }

    // Camera flash decay
    for (let i = 0; i < this.flashSprites.length; i++) {
      const state = this.flashTimes[i]!
      if (state.t === Infinity) continue
      state.t += dt
      let opacity = 0
      for (const spike of state.spikes) {
        const d = (state.t - spike) / 0.07
        opacity += Math.exp(-d * d)
      }
      const sprite = this.flashSprites[i]!
      ;(sprite.material as THREE.SpriteMaterial).opacity = Math.min(opacity, 1)
      if (state.t > 1.4) {
        state.t = Infinity
        sprite.visible = false
      }
    }
  }
}

// ── Realism pass ───────────────────────────────────────────────────────

const naturalized = new WeakSet<THREE.Material>()
const _hsl = { h: 0, s: 0, l: 0 }

/**
 * Convert retrowave-palette materials into believable real-world ones:
 * purples/magentas become warm neutral stone/concrete tones, everything is
 * desaturated and lifted out of near-black (real surfaces are rarely darker
 * than ~4% albedo), neon glow is dimmed for daylight, and every material
 * gets full sky reflections. `light` = gentler pass for authored GLB models.
 * Each material is processed once even though many meshes share it.
 */
/**
 * Keep only the parts of a mesh that reach down to its base. Some rock
 * models contain loose slabs that, scaled up to mountain size, hang in the
 * sky. Triangles are grouped into connected pieces (sharing a vertex
 * position); pieces whose lowest point is well above the base are dropped.
 */
function dropFloatingPieces(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = src.getAttribute('position') as THREE.BufferAttribute
  const idx = src.getIndex()
  const triCount = idx ? idx.count / 3 : pos.count / 3
  const vi = (k: number) => (idx ? idx.getX(k) : k)
  // Weld by position so split UV seams don't break a piece apart
  const key = new Map<string, number>()
  const weld = new Int32Array(pos.count)
  for (let v = 0; v < pos.count; v++) {
    const s = `${pos.getX(v).toFixed(3)},${pos.getY(v).toFixed(3)},${pos.getZ(v).toFixed(3)}`
    let id = key.get(s)
    if (id === undefined) { id = key.size; key.set(s, id) }
    weld[v] = id
  }
  const parent = new Int32Array(key.size).map((_, i) => i)
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]! } return a }
  for (let t = 0; t < triCount; t++) {
    const a = find(weld[vi(t * 3)]!), b = find(weld[vi(t * 3 + 1)]!), c = find(weld[vi(t * 3 + 2)]!)
    parent[b] = a
    parent[find(c)] = a
  }
  let y0 = Infinity, y1 = -Infinity
  for (let v = 0; v < pos.count; v++) { y0 = Math.min(y0, pos.getY(v)); y1 = Math.max(y1, pos.getY(v)) }
  const minY = new Map<number, number>()
  for (let v = 0; v < pos.count; v++) {
    const r = find(weld[v]!)
    minY.set(r, Math.min(minY.get(r) ?? Infinity, pos.getY(v)))
  }
  const limit = y0 + (y1 - y0) * 0.12
  const keep: number[] = []
  for (let t = 0; t < triCount; t++) {
    if (minY.get(find(weld[vi(t * 3)]!))! <= limit) keep.push(vi(t * 3), vi(t * 3 + 1), vi(t * 3 + 2))
  }
  if (keep.length === triCount * 3) return src
  const out = src.clone()
  out.setIndex(keep)
  return out
}

/**
 * Desert mesa / butte: flat top, steep eroded sides with horizontal rock
 * strata (stepped ledges) and an irregular outline — not a smooth cylinder.
 */
function mesaGeometry(w: number, h: number): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(w * 0.72, w, h, 22, 10)
  const pa = geo.getAttribute('position') as THREE.BufferAttribute
  const seed = Math.random() * 10
  for (let k = 0; k < pa.count; k++) {
    const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k)
    const rr = Math.hypot(x, z)
    if (rr < 1e-3) continue // cap centre
    const a = Math.atan2(z, x)
    const yn = y / h + 0.5 // 0 at the base … 1 at the top
    // outline wobble + ledges every 1/5 of the height
    const outline = 1 + 0.13 * Math.sin(a * 3 + seed) + 0.08 * Math.sin(a * 7 + seed * 2) + 0.05 * Math.sin(a * 13)
    const ledge = 1 + 0.06 * (Math.floor(yn * 5) % 2) - 0.04 * Math.sin(yn * 31 + a * 2)
    const s = outline * ledge
    pa.setXYZ(k, x * s, y, z * s)
  }
  geo.computeVertexNormals()
  return geo
}

function naturalize(root: THREE.Object3D, light = false): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    if (!light) mesh.receiveShadow = true
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) {
      if (!(m instanceof THREE.MeshStandardMaterial) || naturalized.has(m)) continue
      naturalized.add(m)
      m.envMapIntensity = 1
      const hasEmissive = m.emissive.r + m.emissive.g + m.emissive.b > 0.05
      if (hasEmissive) m.emissiveIntensity *= light ? 0.7 : 0.4
      if (m.map) continue // textured: the texture already carries its color
      m.color.getHSL(_hsl, THREE.SRGBColorSpace)
      let { h, s, l } = _hsl
      if (light) {
        s *= 0.8
      } else {
        if (h > 0.66 && h < 0.98) { h = 0.08 + (h - 0.66) * 0.1; s *= 0.25 } // purple → warm grey
        else s *= 0.6
        l = Math.min(0.25 + l * 0.9, 0.8)
      }
      m.color.setHSL(h, s, l, THREE.SRGBColorSpace)
    }
  })
}

/**
 * World-space copy of a geometry with only position/normal/uv(/color), all
 * as plain indexed Float32 — so geometries from different GLBs (quantized,
 * interleaved, indexed or not) can always be merged together.
 */
function toPlainGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4, keepColor: boolean, worldUV?: number): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry()
  const pos = src.getAttribute('position')
  const count = pos.count
  const copy = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): THREE.BufferAttribute => {
    const arr = new Float32Array(count * size)
    for (let i = 0; i < count; i++) {
      arr[i * size] = attr.getX(i)
      if (size > 1) arr[i * size + 1] = attr.getY(i)
      if (size > 2) arr[i * size + 2] = attr.getZ(i)
      if (size > 3) arr[i * size + 3] = attr.itemSize > 3 ? attr.getW(i) : 1
    }
    return new THREE.BufferAttribute(arr, size)
  }
  out.setAttribute('position', copy(pos, 3))
  const normal = src.getAttribute('normal')
  if (normal) out.setAttribute('normal', copy(normal, 3))
  const uv = src.getAttribute('uv')
  out.setAttribute('uv', uv ? copy(uv, 2) : new THREE.BufferAttribute(new Float32Array(count * 2), 2))
  if (keepColor) {
    const color = src.getAttribute('color')
    if (color) out.setAttribute('color', copy(color, 4))
    else out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 4).fill(1), 4))
  }
  if (src.index) out.setIndex(Array.from(src.index.array as ArrayLike<number>))
  else out.setIndex(Array.from({ length: count }, (_, i) => i))
  out.applyMatrix4(matrix)
  if (!normal) out.computeVertexNormals()
  if (worldUV) {
    // Models without texture coordinates (low-poly cliffs): project the
    // texture from the dominant axis of each vertex normal, in world metres,
    // so rock texture wraps every face at a consistent scale.
    const P = out.getAttribute('position'), N = out.getAttribute('normal'), U = out.getAttribute('uv')
    for (let i = 0; i < P.count; i++) {
      const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i))
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i)
      if (ay >= ax && ay >= az) U.setXY(i, x / worldUV, z / worldUV)
      else if (ax >= az) U.setXY(i, z / worldUV, y / worldUV)
      else U.setXY(i, x / worldUV, y / worldUV)
    }
  }
  return out
}

/** Key that is equal for materials which render identically. */
function materialSignature(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial
  if (!s.isMeshStandardMaterial) return m.uuid
  const tex = (t: THREE.Texture | null) => (t ? t.uuid : '')
  return [
    m.type, s.color.getHexString(), s.emissive.getHexString(), s.emissiveIntensity.toFixed(2),
    s.roughness.toFixed(2), s.metalness.toFixed(2), s.envMapIntensity.toFixed(2),
    tex(s.map), tex(s.emissiveMap), tex(s.normalMap), tex(s.roughnessMap), tex(s.metalnessMap), tex(s.aoMap), tex(s.alphaMap),
    s.vertexColors, s.transparent, s.opacity.toFixed(2), s.alphaTest, s.side, s.flatShading, s.depthWrite,
    (s as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial ? m.uuid : '',
  ].join('|')
}

/** Soft radial falloff (bright centre → transparent edge) for lamp light pools. */
function lightPoolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Rounded, irregular boulder (smooth-shaded, has UVs for rock texture). */
function lumpyRock(radius: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, 2)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k)
    const s = 0.8 + Math.sin(x * 3.1 + z) * 0.1 + Math.cos(z * 2.7 - y) * 0.1 + Math.sin(y * 4.3) * 0.06
    p.setXYZ(k, x * s, y * s * 0.75, z * s)
  }
  g.computeVertexNormals()
  return g
}

/** Sandstone canyon rock with real surface texture (keeps the faceted shape). */
function canyonRock(color: number): THREE.MeshStandardMaterial {
  const r = tiled(rockSet(), 3, 3)
  return new THREE.MeshStandardMaterial({
    color, map: r.map, normalMap: r.normalMap, normalScale: new THREE.Vector2(1.3, 1.3),
    roughness: 1, flatShading: true,
    userData: { canyonRock: true },
  })
}
