import * as THREE from 'three'
import { GLSL_NOISE, windClock } from './atmos'
import type { World } from '../World'

export interface WaterStyle { deep: number; shallow: number; foam?: number; waves?: number }

/** Live controls for a water surface. */
export interface Water { mesh: THREE.Mesh; swell: { value: number } }

/**
 * Sea and lakes: drifting wave layers for the surface, colour from real depth
 * (the ground under it is baked into a small texture) and foam where it meets
 * the shore.
 */
export function buildWater(w: World, root: THREE.Group, y: number, style: WaterStyle): Water {
  const { nx, nz, x0, z0, cell } = w.gridSize
  const bytes = new Uint8Array(nx * nz * 4)
  for (let k = 0; k < nx * nz; k++) {
    const v = THREE.MathUtils.clamp((y - w.heights[k]!) / 40, -1, 1) * 0.5 + 0.5
    bytes[k * 4] = Math.round(v * 255)
    bytes[k * 4 + 3] = 255
  }
  const depth = new THREE.DataTexture(bytes, nx, nz, THREE.RGBAFormat)
  depth.magFilter = depth.minFilter = THREE.LinearFilter
  depth.needsUpdate = true

  const swell = { value: style.waves ?? 1 }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.08, metalness: 0, envMapIntensity: 1.5 })
  mat.onBeforeCompile = (s) => {
    s.uniforms['tDepth'] = { value: depth }
    s.uniforms['uBox'] = { value: new THREE.Vector4(x0, z0, 1 / ((nx - 1) * cell), 1 / ((nz - 1) * cell)) }
    s.uniforms['uDeep'] = { value: new THREE.Color(style.deep) }
    s.uniforms['uShallow'] = { value: new THREE.Color(style.shallow) }
    s.uniforms['uFoam'] = { value: new THREE.Color(style.foam ?? 0xffffff) }
    s.uniforms['uT'] = windClock
    s.uniforms['uSwell'] = swell
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWw;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWw = (modelMatrix * vec4(position, 1.0)).xyz;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        ${GLSL_NOISE}
        uniform sampler2D tDepth;
        uniform vec4 uBox;
        uniform vec3 uDeep, uShallow, uFoam;
        uniform float uT, uSwell;
        varying vec3 vWw;
        float gFoam;
        float wave(vec2 p) {
          float t = uT;
          return aNoise(p * 0.11 + vec2(t * 0.18, t * 0.1)) + aNoise(p * 0.27 - vec2(t * 0.26, -t * 0.12)) * 0.5
               + aNoise(p * 0.73 + vec2(-t * 0.4, t * 0.35)) * 0.22 + aNoise(p * 1.9 + vec2(t * 0.7, t * 0.5)) * 0.08;
        }`)
      .replace('#include <map_fragment>', `
        {
          vec2 uvD = (vWw.xz - uBox.xy) * uBox.zw;
          bool inside = uvD.x > 0.0 && uvD.y > 0.0 && uvD.x < 1.0 && uvD.y < 1.0;
          float dep = inside ? (texture2D(tDepth, uvD).r * 2.0 - 1.0) * 40.0 : 40.0;
          vec3 c = mix(uShallow, uDeep, smoothstep(0.0, 16.0, dep));
          float n = aFbm(vWw.xz * 0.35 + uT * 0.12);
          float band = sin(dep * 2.4 - uT * 1.3 + n * 5.0) * 0.5 + 0.5;
          gFoam = smoothstep(2.6, 0.2, dep) * smoothstep(0.34, 0.72, n + band * 0.3);
          float crest = smoothstep(0.62, 0.8, aFbm(vWw.xz * 0.05 + uT * 0.05)) * smoothstep(0.5, 0.74, aNoise(vWw.xz * 0.9 + uT * 0.5)) * 0.5 * uSwell;
          gFoam = clamp(gFoam + crest, 0.0, 1.0);
          diffuseColor.rgb = mix(c, uFoam, gFoam);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(roughness, 0.8, gFoam);')
      .replace('#include <normal_fragment_maps>', `
        {
          float e = 0.35;
          float h0 = wave(vWw.xz), hx = wave(vWw.xz + vec2(e, 0.0)), hz = wave(vWw.xz + vec2(0.0, e));
          float amp = 0.42 * uSwell * smoothstep(1400.0, 80.0, length(vWw - cameraPosition)) + 0.05;
          vec3 nw = normalize(vec3(-(hx - h0) / e * amp, 1.0, -(hz - h0) / e * amp));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`)
  }
  mat.customProgramCacheKey = () => 'kart-water'
  const size = Math.max(nx, nz) * cell + 7000
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(x0 + nx * cell / 2, y, z0 + nz * cell / 2)
  mesh.receiveShadow = true
  root.add(mesh)
  return { mesh, swell }
}
