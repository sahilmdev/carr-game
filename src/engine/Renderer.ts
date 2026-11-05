import * as THREE from 'three'

/** Production renderer setup: ACES tone mapping, capped pixel ratio, soft shadows, haze fog. */
export class GameRenderer {
  public readonly renderer: THREE.WebGLRenderer
  public readonly scene: THREE.Scene
  public readonly camera: THREE.PerspectiveCamera

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false, // SMAA post-pass instead
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      alpha: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // Filmic ACES at neutral exposure (the old 1.5 blew everything out)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.scene = new THREE.Scene()
    // Color is replaced with the sky's horizon color once the sky is baked.
    this.scene.fog = new THREE.FogExp2(0xb8c6d4, 0.0012)

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      2000
    )
  }

  /**
   * True on laptop/phone GPUs (Intel Iris/UHD, Mali, Adreno, PowerVR). Those
   * get the "medium" tier: no ambient occlusion, 2K shadow map.
   */
  isIntegratedGpu(): boolean {
    const gl = this.renderer.getContext()
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    return /intel|iris|uhd|hd graphics|mali|adreno|powervr/i.test(name)
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    this.renderer.dispose()
  }
}
