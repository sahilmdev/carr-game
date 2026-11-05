import * as THREE from 'three'

/**
 * Light-speed tunnel: a long tube round the camera with streaks of light
 * racing down it. It covers the world swap on the way to and from the moon.
 */
export class Warp {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private readonly _up = new THREE.Vector3(0, 0, 1)

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, toneMapped: false, fog: false,
      uniforms: { uTime: { value: 0 }, uLevel: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() } },
      vertexShader: 'varying vec2 vU; void main(){ vU=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        varying vec2 vU;
        uniform float uTime, uLevel;
        uniform vec3 uA, uB;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
        void main(){
          float lane = floor(vU.x * 150.0);
          float r = h(vec2(lane, 3.0));
          float z = vU.y * (5.0 + r * 7.0) + uTime * (1.6 + r * 2.8) + r * 9.0;
          float seg = fract(z);
          float streak = smoothstep(0.0, 0.05, seg) * smoothstep(0.55, 0.05, seg) * step(0.4, h(vec2(lane, floor(z))));
          float edge = abs(fract(vU.x * 150.0) - 0.5);
          streak *= smoothstep(0.5, 0.1, edge);
          vec3 c = mix(uA, uB, h(vec2(lane, 9.0)));
          vec3 col = uA * 0.12 + c * streak * 3.2;
          float mouth = smoothstep(0.0, 0.1, vU.y) * smoothstep(1.0, 0.8, vU.y);
          gl_FragColor = vec4(col, uLevel * mix(0.82, 1.0, streak) * mouth);
        }`,
    })
    const geo = new THREE.CylinderGeometry(24, 24, 700, 48, 1, true)
    geo.rotateX(Math.PI / 2)
    this.mesh = new THREE.Mesh(geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 8
    this.mesh.visible = false
  }

  update(time: number, level: number, cam: THREE.Vector3, dir: THREE.Vector3, a: number, b: number): void {
    this.mesh.visible = level > 0.01
    if (!this.mesh.visible) return
    const u = this.mat.uniforms
    u['uTime']!.value = time % 1000
    u['uLevel']!.value = level
    ;(u['uA']!.value as THREE.Color).set(a)
    ;(u['uB']!.value as THREE.Color).set(b)
    this.mesh.position.copy(cam)
    this.mesh.quaternion.setFromUnitVectors(this._up, dir)
  }
}
