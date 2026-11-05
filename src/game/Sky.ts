import * as THREE from 'three'
import { Sky as PhysicalSky } from 'three/addons/objects/Sky.js'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'

/**
 * Realistic sky. The surface sky is either a physically based atmosphere
 * (Preetham scattering, no download needed) or — if the player drops one in
 * `public/hdri/sky.hdr` — a real photographed HDRI. Both are baked into a
 * cubemap that the sky dome samples, so the existing underwater and space
 * looks still blend on top of it exactly as before.
 *
 * Lighting is image-based: a PMREM environment built from the same sky
 * (with the sun removed — the directional light supplies the sun, otherwise
 * shadows get filled in by a second copy of it) lights and reflects
 * everything.
 */

/** Sun placement for the procedural sky: low golden-hour sun over the ocean. */
const SUN_ELEVATION_DEG = 17
const SUN_AZIMUTH_DEG = 20.6 // measured from +X toward +Z (same bearing as the old sunset)

/** Time-of-day presets: sun elevation in degrees. */
export const TIME_OF_DAY = { morning: 17, midday: 50, sunset: 4, night: -9 } as const
export type TimeOfDay = keyof typeof TIME_OF_DAY

/** At night the light comes from the moon: high, cool and faint. */
const MOON_ELEVATION_DEG = 38
const MOON_AZIMUTH_DEG = 200

/** Cloud cover 0 (clear) – 1 (heavy). Procedural sky only; an HDRI has its own clouds. */
const CLOUD_COVER = 0.55

/** Exposure of the procedural sky relative to the sunlit world. */
const PROCEDURAL_GAIN = 0.42
/** Brightness multiplier for an HDRI dome (photos vary a lot in exposure). */
const HDRI_GAIN = 1.0
/** Average upper-sky brightness every photographed sky is scaled to (midday reference). */
const HDRI_REFERENCE_LUMINANCE = 0.46
/** HDR pixels brighter than this are treated as "sun" and removed from the IBL. */
const HDRI_SUN_CLAMP = 6.0

type HdrData = { data: Float32Array<ArrayBuffer>; width: number; height: number }

export class SkySystem {
  public readonly mesh: THREE.Mesh
  /** Unit vector pointing at the sun. Lighting + shadows follow it. */
  public readonly sunDir = new THREE.Vector3()
  /** Linear-space horizon color, used as the fog color so distance fades into the sky. */
  public readonly horizonColor = new THREE.Color(0xb8c6d4)
  /** Sun light color (warm at low elevation; sampled from the HDRI if one loads). */
  public readonly sunColor = new THREE.Color(0xffe0bd)
  /** scene.environmentIntensity to use on the surface (Game lerps it per zone). */
  public envIntensity = 1
  /** 0–1 multiplier for the sun light (dim at sunrise/sunset). */
  public sunStrength = 1
  /** True once a photographed HDRI replaced the procedural sky. */
  public usingHdri = false
  /** 0 = day, 1 = night (stars, moon, street lights). */
  public night = 0
  /** 0 = clear, 1 = raining (overcast, wet). */
  public rain = 0
  /** Multiplier for the hemisphere fill light (dim at night, a bit in rain). */
  public ambientScale = 1
  private tod: TimeOfDay = 'morning'
  get currentTod(): TimeOfDay { return this.tod }

  private gain = PROCEDURAL_GAIN

  private readonly displayCube: THREE.WebGLCubeRenderTarget
  private readonly material: THREE.ShaderMaterial
  private envMap: THREE.Texture | null = null

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly scene: THREE.Scene) {
    this.displayCube = new THREE.WebGLCubeRenderTarget(512, {
      type: THREE.HalfFloatType,
      generateMipmaps: false,
    })

    this.setSunElevation(SUN_ELEVATION_DEG)

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uRealSky: { value: this.displayCube.texture },
        uGain: { value: PROCEDURAL_GAIN },
        uUnderwater: { value: 0 },
        uSpace: { value: 0 },
        uTime: { value: 0 },
        uClouds: { value: CLOUD_COVER },
        uSunDir: { value: this.sunDir },
        uCloudLit: { value: new THREE.Color(1, 1, 1) },
        uCloudShade: { value: new THREE.Color(0.5, 0.55, 0.6) },
        uNight: { value: 0 },
        uOvercast: { value: 0 },
        uOvercastColor: { value: new THREE.Color(0.3, 0.32, 0.35) },
        uMood: { value: 0 },
        uMoodTop: { value: new THREE.Color() },
        uMoodHorizon: { value: new THREE.Color() },
        uMoodStars: { value: 0 },
        uAurora: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform samplerCube uRealSky;
        uniform float uGain;
        uniform float uUnderwater;
        uniform float uSpace;
        uniform float uTime;
        uniform float uClouds;
        uniform vec3 uSunDir;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudShade;
        uniform float uNight;
        uniform float uOvercast;
        uniform vec3 uOvercastColor;
        uniform float uMood;
        uniform vec3 uMoodTop;
        uniform vec3 uMoodHorizon;
        uniform float uMoodStars;
        uniform float uAurora;
        varying vec3 vWorldPosition;

        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        }
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x),
                     mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          return v;
        }

        void main() {
          vec3 dir = normalize(vWorldPosition - cameraPosition);
          float h = dir.y;

          // Real sky (HDR, linear). Clamp so the sun disk can't produce
          // infinite-bright pixels that smear bloom over the whole frame.
          vec3 color = min(textureCube(uRealSky, dir).rgb * uGain, vec3(40.0));

          // Night: twinkling stars and the moon (uSunDir is the moon at night)
          if (uNight > 0.001 && h > 0.0) {
            vec3 sp = floor(dir * 380.0);
            float s = step(0.9965, hash(sp)) * (0.6 + 0.4 * sin(uTime * 3.0 + hash(sp + 7.0) * 40.0));
            float s2 = step(0.9994, hash(floor(dir * 150.0)));
            float fade = smoothstep(0.0, 0.25, h);
            color += (vec3(0.8, 0.85, 1.0) * s * 0.35 + vec3(1.0, 0.95, 0.9) * s2 * 0.9) * fade * uNight;
            float md = dot(dir, uSunDir);
            float disc = smoothstep(0.99955, 0.9997, md);
            float spots = 0.85 + 0.15 * sin(dir.x * 900.0) * sin(dir.y * 800.0);
            color += vec3(0.85, 0.88, 0.95) * disc * spots * 2.5 * uNight;
            color += vec3(0.25, 0.3, 0.45) * pow(max(md, 0.0), 300.0) * 0.6 * uNight; // halo
          }

          // Rain: a low uniform overcast deck over the whole sky
          if (uOvercast > 0.001) {
            vec3 deck = uOvercastColor * (0.8 + 0.35 * smoothstep(-0.05, 0.7, h));
            color = mix(color, deck, uOvercast * smoothstep(-0.25, 0.04, h));
          }

          // Drifting cumulus layer: fbm projected onto a flat cloud deck,
          // lit from the sun side with a darker, bluish underside.
          if (uClouds > 0.001 && h > 0.0) {
            vec2 cp = dir.xz / (h + 0.12) * 1.4 + vec2(uTime * 0.006, uTime * 0.002);
            float d = fbm(cp);
            float cov = smoothstep(0.62 - 0.2 * uClouds, 0.9 - 0.1 * uClouds, d);
            cov *= smoothstep(0.0, 0.12, h); // thin out toward the horizon
            vec2 toSun = normalize(uSunDir.xz + 1e-4) * 0.09;
            float dSun = fbm(cp + toSun);
            float lit = clamp(0.55 + (d - dSun) * 5.0, 0.0, 1.0);
            vec3 cloud = mix(uCloudShade, uCloudLit, lit);
            // Bright silver lining around the sun
            cloud += uCloudLit * pow(max(dot(dir, uSunDir), 0.0), 12.0) * 0.8 * (1.0 - cov * 0.5);
            color = mix(color, cloud, cov * 0.92);
          }

          // Biome mood: volcanic ash, sandstorm, alpine haze, neon night…
          if (uMood > 0.001) {
            vec3 mood = mix(uMoodHorizon, uMoodTop, smoothstep(-0.02, 0.55, h));
            // the sun still glows through thin haze
            mood += vec3(1.0, 0.85, 0.6) * pow(max(dot(dir, uSunDir), 0.0), 24.0) * 0.6 * (1.0 - uMood * 0.7);
            color = mix(color, mood, uMood);
            if (uMoodStars > 0.001 && h > 0.0) {
              vec3 sp = floor(dir * 380.0);
              float st = step(0.997, hash(sp)) * (0.6 + 0.4 * sin(uTime * 3.0 + hash(sp + 7.0) * 40.0));
              color += vec3(0.8, 0.85, 1.0) * st * 0.4 * uMoodStars * smoothstep(0.05, 0.3, h);
            }
          }
          // Northern lights: slow green curtains with violet hems
          if (uAurora > 0.001 && h > 0.02) {
            vec2 ap = dir.xz / (h + 0.25);
            float wave = sin(ap.x * 2.2 + fbm(ap * 0.8 + uTime * 0.02) * 4.0 + uTime * 0.05);
            float band = smoothstep(0.25, 1.0, wave) * smoothstep(0.05, 0.25, h) * (1.0 - smoothstep(0.45, 0.85, h));
            float rays = 0.6 + 0.4 * fbm(vec2(ap.x * 12.0, uTime * 0.1));
            vec3 au = mix(vec3(0.1, 1.0, 0.45), vec3(0.6, 0.2, 1.0), smoothstep(0.3, 0.7, h));
            color += au * band * rays * uAurora * 0.55;
          }

          // Underwater: whole sky becomes deep ocean blue (brighter overhead)
          vec3 waterDeep = vec3(0.01, 0.10, 0.14);
          vec3 waterLight = vec3(0.06, 0.32, 0.38);
          vec3 waterColor = mix(waterDeep, waterLight, clamp(h + 0.4, 0.0, 1.0));
          color = mix(color, waterColor, uUnderwater);

          // Space: near-black navy, dense starfield everywhere, faint nebula band
          if (uSpace > 0.001) {
            vec3 spaceColor = mix(vec3(0.004, 0.004, 0.015), vec3(0.001, 0.001, 0.006),
                                  clamp(h * 0.5 + 0.5, 0.0, 1.0));
            vec3 sp1 = floor(dir * 420.0);
            vec3 sp2 = floor(dir * 160.0);
            float star1 = step(0.9974, hash(sp1));
            float star2 = step(0.9992, hash(sp2));
            spaceColor += vec3(0.85, 0.9, 1.0) * star1 * 0.9;
            spaceColor += vec3(1.0, 0.95, 0.85) * star2 * 1.6;
            float band = exp(-pow(dot(dir, normalize(vec3(0.45, 0.35, -0.6))), 2.0) * 6.0);
            // faint, neutral Milky Way haze (was a strong purple wash)
            spaceColor += vec3(0.016, 0.016, 0.02) * band;
            color = mix(color, spaceColor, uSpace);
          }

          // keep the sky under the bloom threshold: only lights and neon glow,
          // otherwise the sky round a low sun whites out the whole frame
          color *= 0.92 / max(dot(color, vec3(0.2126, 0.7152, 0.0722)), 0.92);

          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    })

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 48, 24), this.material)
    this.mesh.frustumCulled = false
    scene.add(this.mesh)
    scene.background = null

    this.bakeProcedural()
  }

  // ── Procedural atmosphere ────────────────────────────────────────────

  private makePhysicalSky(withSunDisk: boolean, turbidity = 2.5): PhysicalSky {
    const sky = new PhysicalSky()
    sky.scale.setScalar(10000)
    const mat = sky.material as THREE.ShaderMaterial
    const u = mat.uniforms
    u['turbidity']!.value = turbidity
    u['rayleigh']!.value = 3
    u['mieCoefficient']!.value = 0.0025
    u['mieDirectionalG']!.value = 0.82
    u['sunPosition']!.value.copy(this.sunDir).multiplyScalar(450000)
    if (!withSunDisk) {
      mat.fragmentShader = mat.fragmentShader.replace(
        'L0 += ( vSunE * 19000.0 * Fex ) * sundisk;',
        ''
      )
    }
    return sky
  }

  private renderToCube(object: THREE.Object3D, target: THREE.WebGLCubeRenderTarget): void {
    const tmp = new THREE.Scene()
    tmp.add(object)
    const cam = new THREE.CubeCamera(1, 100000, target)
    cam.update(this.renderer, tmp)
  }

  /** Aim the sun (procedural sky) and derive its color and strength. */
  private setSunElevation(deg: number): void {
    const el = THREE.MathUtils.degToRad(deg)
    const az = THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG)
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize()
    // Low sun: warm orange and weaker (more atmosphere in the way)
    const t = THREE.MathUtils.smoothstep(deg, 2, 35)
    this.sunColor.lerpColors(new THREE.Color(0xffa060), new THREE.Color(0xfff4e8), t)
    this.sunStrength = 0.55 + 0.45 * t
  }

  /**
   * Switch time of day (procedural sky only — an HDRI photo has a fixed sun).
   * Re-bakes the sky, lighting environment and haze. Returns false if ignored.
   */
  setTimeOfDay(tod: TimeOfDay): boolean {
    return this.setConditions(tod, this.rain > 0.5)
  }

  /**
   * Time of day + weather. Re-bakes the sky, lighting environment and haze.
   * With a photographed HDRI only the rain overlay applies (the photo fixes
   * the sun). Returns false if the time of day could not be changed.
   */
  setConditions(tod: TimeOfDay, raining: boolean): boolean {
    this.rain = raining ? 1 : 0
    const u = this.material.uniforms
    this.tod = tod
    // A photographed sky for this time of day? Use it (weather on top).
    const photo = this.hdri.get(tod)
    if (photo) {
      this.night = 0
      u['uNight']!.value = 0
      this.ambientScale = 1
      this.applyHdri(photo)
      this.applyRain()
      return true
    }
    // Otherwise the generated sky
    this.usingHdri = false
    this.gain = PROCEDURAL_GAIN
    u['uGain']!.value = PROCEDURAL_GAIN
    this.night = tod === 'night' ? 1 : 0
    this.setSunElevation(TIME_OF_DAY[tod])
    this.bakeProcedural(raining ? 9 : 2.5)
    if (this.night) {
      // Light now comes from the moon (the sky above was baked with the sun
      // just below the horizon, giving a deep blue twilight dome)
      const el = THREE.MathUtils.degToRad(MOON_ELEVATION_DEG)
      const az = THREE.MathUtils.degToRad(MOON_AZIMUTH_DEG)
      this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize()
      this.sunColor.set(0xa9bcff)
      this.sunStrength = 0.09
      this.horizonColor.multiplyScalar(0.6).add(new THREE.Color(0.004, 0.006, 0.012))
      this.envIntensity = Math.max(this.envIntensity, 0.9)
      this.updateCloudColors()
    }
    u['uNight']!.value = this.night
    this.ambientScale = this.night ? 0.3 : 1
    this.applyRain()
    return true
  }

  /** Overcast deck, dim sun, grey haze and heavy cloud while it rains. */
  private applyRain(): void {
    const u = this.material.uniforms
    u['uOvercast']!.value = this.rain ? 0.85 : 0
    if (!this.usingHdri) u['uClouds']!.value = this.rain ? 1 : CLOUD_COVER
    if (!this.rain) return
    const hz = this.horizonColor
    const lum = hz.r * 0.2126 + hz.g * 0.7152 + hz.b * 0.0722
    const grey = new THREE.Color(lum, lum * 1.03, lum * 1.08)
    hz.lerp(grey, 0.75).multiplyScalar(0.8)
    ;(u['uOvercastColor']!.value as THREE.Color).copy(hz).multiplyScalar(this.night ? 1.4 : 1.05)
    this.sunStrength *= 0.28
    this.ambientScale *= 0.85
    this.envIntensity *= 0.6
    ;(u['uCloudLit']!.value as THREE.Color).copy(hz).multiplyScalar(0.95)
    ;(u['uCloudShade']!.value as THREE.Color).copy(hz).multiplyScalar(0.55)
  }

  update(time: number): void {
    this.material.uniforms['uTime']!.value = time % 10000
  }

  private bakeProcedural(turbidity = 2.5): void {
    this.renderToCube(this.makePhysicalSky(true, turbidity), this.displayCube)

    const envCube = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType })
    this.renderToCube(this.makePhysicalSky(false, turbidity), envCube)
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.setEnv(pmrem.fromCubemap(envCube.texture).texture)
    pmrem.dispose()
    envCube.dispose()

    this.sampleHorizon()
    this.updateCloudColors()
  }

  /** Cloud tops take the sun's color; undersides the hazy sky color. */
  private updateCloudColors(): void {
    const u = this.material.uniforms
    const hz = this.horizonColor
    const lum = Math.max(0.05, hz.r * 0.2126 + hz.g * 0.7152 + hz.b * 0.0722)
    ;(u['uCloudLit']!.value as THREE.Color).copy(this.sunColor).multiplyScalar(lum * 2.2 * this.sunStrength)
    ;(u['uCloudShade']!.value as THREE.Color).copy(hz).multiplyScalar(0.72)
  }

  private setEnv(tex: THREE.Texture): void {
    this.envMap?.dispose()
    this.envMap = tex
    this.scene.environment = tex
    this.envIntensity = this.gain * 1.8
    this.scene.environmentIntensity = this.envIntensity
  }

  /** Average the horizon ring of the display cube → fog color matches the sky. */
  private sampleHorizon(): void {
    try {
      const size = this.displayCube.width
      const row = new Uint16Array(size * 4)
      let r = 0, g = 0, b = 0, n = 0
      for (const face of [0, 1, 4, 5]) {
        this.renderer.readRenderTargetPixels(this.displayCube, 0, Math.floor(size / 2), size, 1, row, face)
        for (let i = 0; i < size; i++) {
          const R = THREE.DataUtils.fromHalfFloat(row[i * 4]!)
          const G = THREE.DataUtils.fromHalfFloat(row[i * 4 + 1]!)
          const B = THREE.DataUtils.fromHalfFloat(row[i * 4 + 2]!)
          if (R + G + B > 30) continue // skip the sun disk
          r += R; g += G; b += B; n++
        }
      }
      if (n > 0 && r + g + b > 0) {
        const k = (this.gain * 0.85) / n // haze a touch darker than the bright horizon line
        this.horizonColor.setRGB(r * k, g * k, b * k, THREE.LinearSRGBColorSpace)
      }
    } catch {
      // Readback unsupported — keep the default haze color.
    }
  }

  // ── Optional photographed HDRI ───────────────────────────────────────

  private readonly hdri = new Map<TimeOfDay, HdrData>()

  /**
   * Load photographed skies (Radiance .hdr) per time of day, e.g.
   * { midday: 'hdri/midday.hdr', sunset: 'hdri/sunset.hdr' }. Missing files
   * are skipped and that time of day keeps the generated sky.
   */
  async loadHdris(urls: Partial<Record<TimeOfDay, string>>): Promise<number> {
    let loaded = 0
    await Promise.all(Object.entries(urls).map(async ([tod, url]) => {
      try {
        // Fetch first: a missing file comes back as the dev server's HTML
        // page, which RGBELoader would choke on.
        const res = await fetch(url!)
        if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return
        const parsed = new RGBELoader().setDataType(THREE.FloatType).parse(await res.arrayBuffer()) as unknown as HdrData
        if (parsed?.data && parsed.width) { this.hdri.set(tod as TimeOfDay, parsed); loaded++ }
      } catch { /* not provided */ }
    }))
    return loaded
  }

  /** Switch dome, IBL, haze, sun direction + colour to a photographed sky. */
  private applyHdri(img: HdrData): void {
    const tex = new THREE.DataTexture(img.data, img.width, img.height, THREE.RGBAFormat, THREE.FloatType)
    tex.mapping = THREE.EquirectangularReflectionMapping
    tex.flipY = true
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    tex.needsUpdate = true
    this.gain = HDRI_GAIN

    // Display: full-range photo, sun included.
    this.displayCube.fromEquirectangularTexture(this.renderer, tex)
    this.material.uniforms['uGain']!.value = HDRI_GAIN
    this.material.uniforms['uClouds']!.value = 0 // the photo has real clouds
    this.usingHdri = true

    // Find the sun (brightest region) → directional light direction + color.
    const { data, width: W, height: H } = img
    let best = -1, bi = 0
    for (let i = 0; i < W * H; i++) {
      const l = data[i * 4]! * 0.2126 + data[i * 4 + 1]! * 0.7152 + data[i * 4 + 2]! * 0.0722
      if (l > best) { best = l; bi = i }
    }
    const px = bi % W
    const py = Math.floor(bi / W)
    const u = (px + 0.5) / W
    const v = 1 - (py + 0.5) / H
    const lon = (u - 0.5) * Math.PI * 2
    const lat = (v - 0.5) * Math.PI
    const sun = new THREE.Vector3(Math.cos(lon) * Math.cos(lat), Math.sin(lat), Math.sin(lon) * Math.cos(lat))
    sun.normalize()
    sun.y = Math.max(sun.y, 0.05) // dusk photos: keep the light just above the horizon
    this.sunDir.copy(sun.normalize())
    const elev = THREE.MathUtils.radToDeg(Math.asin(this.sunDir.y))
    this.sunStrength = 0.55 + 0.45 * THREE.MathUtils.smoothstep(elev, 2, 35)

    // Photos vary a lot in exposure (a dusk photo here was 2.4× brighter
    // than the midday one). Normalise the upper sky to a reference
    // brightness, then dim lower suns, so every photo sits right in-game.
    let lumSum = 0, lumN = 0
    for (let y = 0; y < H / 2; y++) {
      for (let x = 0; x < W; x += 2) {
        const o = (y * W + x) * 4
        lumSum += Math.min(HDRI_SUN_CLAMP, data[o]! * 0.2126 + data[o + 1]! * 0.7152 + data[o + 2]! * 0.0722)
        lumN++
      }
    }
    const norm = THREE.MathUtils.clamp(HDRI_REFERENCE_LUMINANCE / Math.max(lumSum / lumN, 1e-4), 0.15, 3)
    this.gain = HDRI_GAIN * norm * (0.6 + 0.4 * THREE.MathUtils.smoothstep(elev, 2, 35))
    this.material.uniforms['uGain']!.value = this.gain
    const sr = data[bi * 4]!, sg = data[bi * 4 + 1]!, sb = data[bi * 4 + 2]!
    const smax = Math.max(sr, sg, sb, 1e-6)
    this.sunColor.setRGB(sr / smax, sg / smax, sb / smax, THREE.LinearSRGBColorSpace)

    // IBL: same photo with the sun clamped out (the light provides it).
    const clamped = new Float32Array(data)
    for (let i = 0; i < W * H; i++) {
      for (let c = 0; c < 3; c++) clamped[i * 4 + c] = Math.min(clamped[i * 4 + c]!, HDRI_SUN_CLAMP)
    }
    const envTex = new THREE.DataTexture(clamped, W, H, THREE.RGBAFormat, THREE.FloatType)
    envTex.mapping = THREE.EquirectangularReflectionMapping
    envTex.flipY = tex.flipY
    envTex.needsUpdate = true
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.setEnv(pmrem.fromEquirectangular(envTex).texture)
    pmrem.dispose()
    envTex.dispose()
    tex.dispose()

    this.sampleHorizon()
  }

  /** Biome sky tint (0 = none) with optional stars and aurora. */
  setMood(mix: number, top: THREE.Color, horizon: THREE.Color, stars: number, aurora: number): void {
    const u = this.material.uniforms
    u['uMood']!.value = mix
    ;(u['uMoodTop']!.value as THREE.Color).copy(top)
    ;(u['uMoodHorizon']!.value as THREE.Color).copy(horizon)
    u['uMoodStars']!.value = stars
    u['uAurora']!.value = aurora
  }

  /** Keep the dome centred on the camera (the world is bigger than it). */
  follow(pos: THREE.Vector3): void {
    this.mesh.position.copy(pos)
  }

  setZones(underwater: number, space: number): void {
    this.material.uniforms['uUnderwater']!.value = underwater
    this.material.uniforms['uSpace']!.value = space
  }
}
