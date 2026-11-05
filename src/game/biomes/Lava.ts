import * as THREE from 'three'

/**
 * Molten lava: dark cooling crust plates drifting over a glowing orange
 * melt. `flowUv` = the flow runs along uv.y (rivers, channels); otherwise
 * it churns in world XZ (the lake).
 */
export function lavaMaterial(flowUv: boolean, shaders: { uniforms: Record<string, THREE.IUniform> }[], glow = 1): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x120806, roughness: 0.75, metalness: 0, emissive: 0xffffff })
  mat.customProgramCacheKey = () => `lava-${flowUv}-${glow}`
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = { value: 0 }
    shaders.push(shader)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vLavaUv;\nvarying vec2 vLavaXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLavaUv = uv;\nvLavaXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec2 vLavaUv;
        varying vec2 vLavaXZ;
        uniform float uTime;
        float lh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float ln(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(lh(i), lh(i + vec2(1.0, 0.0)), f.x), mix(lh(i + vec2(0.0, 1.0)), lh(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        // distance to the nearest cell edge: crust plate seams
        float cellEdge(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          float d1 = 8.0, d2 = 8.0;
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y));
            vec2 o = vec2(lh(i + g), lh(i + g + 13.7));
            float d = length(g + o - f);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          return d2 - d1;
        }
        float lavaHeat = 0.0;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        {
          ${flowUv
            ? 'vec2 lp = vec2(vLavaUv.x * 2.2, vLavaUv.y * 0.35 - uTime * 0.22);'
            : 'vec2 lp = vLavaXZ * 0.09 + vec2(sin(uTime * 0.05), cos(uTime * 0.04)) * 2.0;'}
          float seam = cellEdge(lp);
          float churn = ln(lp * 2.3 + uTime * 0.15) * 0.6 + ln(lp * 5.1 - uTime * 0.21) * 0.4;
          lavaHeat = smoothstep(0.16, 0.0, seam) * 0.8 + smoothstep(0.62, 0.95, churn) * 0.7;
          ${flowUv ? 'lavaHeat += smoothstep(0.35, 0.0, abs(vLavaUv.x - 0.5)) * 0.55;' : ''}
          lavaHeat = clamp(lavaHeat, 0.0, 1.0);
          diffuseColor.rgb = mix(vec3(0.05, 0.035, 0.03), vec3(0.3, 0.06, 0.01), lavaHeat);
        }`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        {
          vec3 hot = mix(vec3(0.9, 0.12, 0.01), vec3(1.0, 0.62, 0.12), lavaHeat * lavaHeat);
          totalEmissiveRadiance = hot * (0.25 + lavaHeat * 4.2) * ${glow.toFixed(2)};
        }`)
  }
  return mat
}
