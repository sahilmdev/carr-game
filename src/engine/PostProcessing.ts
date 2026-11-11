import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js'
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { CopyShader } from 'three/addons/shaders/CopyShader.js'

export interface PostOptions {
  /** Screen-space ambient occlusion (contact shadows). The most expensive pass. */
  ao: boolean
  /** SMAA (sharper) instead of FXAA. ~7 ms vs ~1 ms on integrated GPUs. */
  smaa: boolean
  /** Glow around lights and the sun. */
  bloom: boolean
  /** Hardware antialiasing samples; replaces SMAA and FXAA when set. */
  msaa?: number
}

/**
 * The scene drawn into its own antialiased target, then copied into the
 * chain. Only this one pass pays for the extra samples.
 */
class MsaaScenePass extends Pass {
  private readonly target: THREE.WebGLRenderTarget
  private readonly quad: FullScreenQuad
  private readonly copy: THREE.ShaderMaterial

  constructor(private readonly scene: THREE.Scene, private readonly camera: THREE.Camera, samples: number) {
    super()
    this.needsSwap = false
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples })
    this.copy = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(CopyShader.uniforms), vertexShader: CopyShader.vertexShader, fragmentShader: CopyShader.fragmentShader, depthTest: false, depthWrite: false })
    this.quad = new FullScreenQuad(this.copy)
  }

  override setSize(w: number, h: number): void { this.target.setSize(w, h) }

  override render(r: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget): void {
    r.setRenderTarget(this.target)
    r.clear()
    r.render(this.scene, this.camera)
    this.copy.uniforms['tDiffuse']!.value = this.target.texture
    r.setRenderTarget(read)
    this.quad.render(r)
  }
}

/**
 * Realistic pipeline: render → ambient occlusion → bloom (HDR highlights
 * only) → tone map/sRGB → grade (motion blur, vignette, light grain) →
 * SMAA or FXAA. Every optional pass can be switched at runtime (settings).
 */
export class PostProcessing {
  private composer: EffectComposer
  private gradePass: ShaderPass
  private bloomPass: UnrealBloomPass
  private aoPass: GTAOPass | null = null
  private smaaPass: SMAAPass
  private fxaaPass: ShaderPass
  private readonly msaa: boolean

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    opts: PostOptions
  ) {
    const w = window.innerWidth
    const h = window.innerHeight
    // (EffectComposer's default buffers are HalfFloat, so bloom and tone
    // mapping see real HDR values.)
    this.msaa = !!opts.msaa
    this.composer = new EffectComposer(renderer)
    this.composer.addPass(opts.msaa ? new MsaaScenePass(scene, camera, opts.msaa) : new RenderPass(scene, camera))
    // One bad pixel (not a number, or past what a half-float holds, as when
    // many additive glows stack up) would be smeared over the whole screen by
    // the bloom blur and turn it black for seconds. Clean the image first.
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          // isnan/isinf: a self-comparison test gets optimised away on some drivers (Intel through ANGLE)
          if (any(isnan(c)) || any(isinf(c)) || c.r > 6.0e4 || c.g > 6.0e4 || c.b > 6.0e4) c = vec4(0.0, 0.0, 0.0, 1.0);
          gl_FragColor = vec4(clamp(c.rgb, 0.0, 48.0), clamp(c.a, 0.0, 1.0));
        }`,
    }))

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      0.22, // strength — a soft glare around lights and the sun, not a haze
      0.55, // radius
      1.15  // threshold (linear HDR) — only lamps, tail lights and the sun bloom
    )
    this.composer.addPass(this.bloomPass)

    // Tone mapping + sRGB conversion happens here
    this.composer.addPass(new OutputPass())

    this.gradePass = new ShaderPass(this.buildGradeShader())
    this.composer.addPass(this.gradePass)

    const pr = renderer.getPixelRatio()
    this.smaaPass = new SMAAPass(w * pr, h * pr)
    this.composer.addPass(this.smaaPass)
    this.fxaaPass = new ShaderPass(FXAAShader)
    this.composer.addPass(this.fxaaPass)
    this.setFxaaResolution(w, h)

    this.setOptions(opts)
  }

  /** Switch effects on/off at runtime (the composer skips disabled passes). */
  setOptions(opts: PostOptions): void {
    if (opts.ao && !this.aoPass) this.createAo()
    if (this.aoPass) this.aoPass.enabled = opts.ao
    this.bloomPass.enabled = opts.bloom
    this.smaaPass.enabled = opts.smaa && !this.msaa
    this.fxaaPass.enabled = !opts.smaa && !this.msaa
  }

  /** Created on first use: its buffers cost memory even while disabled. */
  private createAo(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    const ao = new GTAOPass(this.scene, this.camera, w, h)
    ao.updateGtaoMaterial({
      radius: 1.6,
      distanceExponent: 1.4,
      thickness: 1.5,
      scale: 1.0,
      samples: 12,
    })
    ao.blendIntensity = 0.85
    // AO is soft and low-frequency: half resolution looks the same at a
    // fraction of the cost.
    const fullSetSize = ao.setSize.bind(ao)
    ao.setSize = (sw: number, sh: number) => fullSetSize(Math.ceil(sw / 2), Math.ceil(sh / 2))
    const pr = this.renderer.getPixelRatio()
    ao.setSize(w * pr, h * pr)
    this.composer.insertPass(ao, 1) // right after the scene render
    this.aoPass = ao
  }

  setMotionBlur(on: boolean): void {
    this.gradePass.uniforms['uMotionBlur']!.value = on ? 1 : 0
  }

  private setFxaaResolution(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio()
    this.fxaaPass.uniforms['resolution']!.value.set(1 / (w * pr), 1 / (h * pr))
  }

  private buildGradeShader() {
    return {
      uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uSpeed: { value: 0 }, // normalized 0–1
        uMotionBlur: { value: 1 },
        uSaturation: { value: 1.06 },
        uContrast: { value: 1.04 },
        uVignetteStr: { value: 0.22 },
        uGrain: { value: 0.008 },
        uLift: { value: new THREE.Vector3(0, 0, 0) },
        uGain: { value: new THREE.Vector3(1, 1, 1) },
        uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
        uSun: { value: new THREE.Vector3(0.5, 0.5, 0) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uSpeed;
        uniform float uMotionBlur;
        uniform float uSaturation;
        uniform float uContrast;
        uniform float uVignetteStr;
        uniform float uGrain;
        uniform vec3 uLift;
        uniform vec3 uGain;
        uniform vec4 uFlash;
        uniform vec3 uSun;
        varying vec2 vUv;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;

          // Radial motion blur at speed: the screen edges streak toward the
          // vanishing point while the centre (car + road ahead) stays sharp.
          float blur = smoothstep(0.45, 1.0, uSpeed) * uMotionBlur;
          if (blur > 0.001) {
            vec2 toC = vUv - vec2(0.5, 0.56);
            float edge = smoothstep(0.12, 0.6, length(toC));
            vec2 stepUv = toC * 0.014 * blur * edge;
            vec3 acc = color;
            for (int i = 1; i < 8; i++) acc += texture2D(tDiffuse, vUv - stepUv * float(i)).rgb;
            color = acc / 8.0;
          }

          // Light shafts: bright sky seen past things, smeared away from the sun
          if (uSun.z > 0.001) {
            vec2 toSun = (uSun.xy - vUv) / 14.0;
            vec2 q = vUv + toSun * hash(vUv * 91.7 + uTime);
            float glow = 0.0;
            for (int i = 0; i < 14; i++) {
              vec3 s = texture2D(tDiffuse, q).rgb;
              glow += smoothstep(0.72, 1.0, dot(s, vec3(0.333))) * (1.0 - float(i) / 20.0);
              q += toSun;
            }
            float fall = smoothstep(1.05, 0.0, length((vUv - uSun.xy) * vec2(1.6, 1.0)));
            color += vec3(1.0, 0.86, 0.68) * (glow / 14.0) * fall * uSun.z;
          }

          // Light saturation + contrast around mid-grey
          float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = mix(vec3(lum), color, uSaturation);
          color = (color - 0.5) * uContrast + 0.5;
          color = clamp(color, 0.0, 1.0);
          // Per-area grade: tint the highlights (gain) and lift the shadows
          color = color * uGain + uLift * (1.0 - color);
          // Transition flash between areas
          color = mix(color, uFlash.rgb, uFlash.a);

          // Lens vignette — slightly stronger at speed to focus the eye
          vec2 vigUv = vUv * 2.0 - 1.0;
          float str = uVignetteStr * (1.0 + uSpeed * 0.6);
          float vignette = 1.0 - dot(vigUv * 0.45, vigUv * 0.45) * str;
          color *= clamp(vignette, 0.0, 1.0);

          // Barely-there sensor grain (breaks up gradient banding in the sky)
          color += (hash(vUv * (uTime + 1.0) * 120.0) - 0.5) * uGrain;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }
  }

  /** Night wants more glow from lamps and lit windows than daylight does. */
  setBloom(strength: number, threshold: number): void {
    this.bloomPass.strength = strength
    this.bloomPass.threshold = threshold
  }

  /** Area colour grade (see biomes/Grade.ts). */
  setGrade(g: Float32Array): void {
    const u = this.gradePass.uniforms
    u['uSaturation']!.value = g[0]
    u['uContrast']!.value = g[1]
    ;(u['uLift']!.value as THREE.Vector3).set(g[2]!, g[3]!, g[4]!)
    ;(u['uGain']!.value as THREE.Vector3).set(g[5]!, g[6]!, g[7]!)
    u['uVignetteStr']!.value = g[8]
  }

  /** Full-screen colour flash (0 = none), for area transitions. */
  setFlash(r: number, g: number, b: number, a: number): void {
    ;(this.gradePass.uniforms['uFlash']!.value as THREE.Vector4).set(r, g, b, a)
  }

  /** Where the sun is on screen (0-1), and how strong its light shafts are. */
  setSun(x: number, y: number, strength: number): void {
    ;(this.gradePass.uniforms['uSun']!.value as THREE.Vector3).set(x, y, strength)
  }

  setSpeed(normalizedSpeed: number): void {
    this.gradePass.uniforms['uSpeed']!.value = normalizedSpeed
  }

  setTime(time: number): void {
    this.gradePass.uniforms['uTime']!.value = time % 10
  }

  render(dt: number): void {
    this.composer.render(dt)
  }

  resize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(w, h)
    this.setFxaaResolution(w, h)
  }

  dispose(): void {
    this.composer.dispose()
  }
}
