import * as THREE from 'three'

export interface LightRig {
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  fill: THREE.DirectionalLight
  ambient: THREE.AmbientLight
}

/** Half-size (m) of the shadow box that follows the camera. Smaller = sharper. */
const SHADOW_RADIUS = 75
const SHADOW_DISTANCE = 400 // how far up the sun ray the light sits

/**
 * Daylight rig. The sky's image-based environment does most of the fill
 * lighting, so this is just one strong sun (which casts the shadows) plus a
 * faint hemisphere. `fill` and `ambient` are kept (at zero by day) so the
 * game can still lerp toward the cold space rig.
 */
export function setupLighting(scene: THREE.Scene, sunDir: THREE.Vector3, highQuality: boolean): LightRig {
  const hemi = new THREE.HemisphereLight(DAY_RIG.hemiSky, DAY_RIG.hemiGround, DAY_RIG.hemiIntensity)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(DAY_RIG.sunColor, DAY_RIG.sunIntensity)
  sun.position.copy(sunDir).multiplyScalar(SHADOW_DISTANCE)
  sun.castShadow = true
  const mapSize = highQuality ? 4096 : 2048
  sun.shadow.mapSize.set(mapSize, mapSize)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = SHADOW_DISTANCE * 2
  sun.shadow.camera.left = -SHADOW_RADIUS
  sun.shadow.camera.right = SHADOW_RADIUS
  sun.shadow.camera.top = SHADOW_RADIUS
  sun.shadow.camera.bottom = -SHADOW_RADIUS
  sun.shadow.bias = -0.0003
  sun.shadow.normalBias = 0.04
  sun.shadow.radius = 2
  scene.add(sun)
  scene.add(sun.target)

  const fill = new THREE.DirectionalLight(DAY_RIG.fillColor, DAY_RIG.fillIntensity)
  fill.position.set(-300, 140, 60)
  scene.add(fill)

  const ambient = new THREE.AmbientLight(DAY_RIG.ambientColor, DAY_RIG.ambientIntensity)
  scene.add(ambient)

  return { hemi, sun, fill, ambient }
}

/** Change the shadow map resolution at runtime (quality setting). */
export function setShadowMapSize(rig: LightRig, size: number): void {
  const s = rig.sun.shadow
  if (s.mapSize.x === size) return
  s.mapSize.set(size, size)
  s.map?.dispose()
  s.map = null // re-allocated at the new size on the next frame
}

const _fwd = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _snapped = new THREE.Vector3()
const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * Keep the (small, sharp) shadow box centred on `focus`. The centre is
 * snapped to whole shadow-map texels in light space so shadow edges don't
 * shimmer as the camera moves.
 */
export function followShadow(rig: LightRig, focus: THREE.Vector3, sunDir: THREE.Vector3): void {
  const sun = rig.sun
  const texel = (SHADOW_RADIUS * 2) / sun.shadow.mapSize.x
  _fwd.copy(sunDir).negate()
  _right.crossVectors(_fwd, WORLD_UP).normalize()
  _up.crossVectors(_right, _fwd)
  const r = Math.round(focus.dot(_right) / texel) * texel
  const u = Math.round(focus.dot(_up) / texel) * texel
  const f = focus.dot(_fwd)
  _snapped.copy(_right).multiplyScalar(r).addScaledVector(_up, u).addScaledVector(_fwd, f)
  sun.target.position.copy(_snapped)
  sun.target.updateMatrixWorld()
  sun.position.copy(_snapped).addScaledVector(sunDir, SHADOW_DISTANCE)
}

/** Daytime rig (the lerp "from" pose). Sun color is overwritten from the sky/HDRI. */
export const DAY_RIG = {
  hemiSky: new THREE.Color(0xc4d6f0),
  hemiGround: new THREE.Color(0x6e5f4a),
  hemiIntensity: 0.35,
  sunColor: new THREE.Color(0xffe0bd),
  sunIntensity: 3.4,
  fillColor: new THREE.Color(0x8899bb),
  fillIntensity: 0,
  ambientColor: new THREE.Color(0x404850),
  ambientIntensity: 0,
} as const

/** Cold space rig — blue-white key, dim fill, starlight ambience. */
export const SPACE_RIG = {
  hemiSky: new THREE.Color(0x9aabdd),
  hemiGround: new THREE.Color(0x1a1d30),
  hemiIntensity: 1.15,
  sunColor: new THREE.Color(0xcdd8ff),
  sunIntensity: 3.4,
  fillColor: new THREE.Color(0x5566aa),
  fillIntensity: 0.9,
  ambientColor: new THREE.Color(0x232a48),
  ambientIntensity: 0.9,
} as const
