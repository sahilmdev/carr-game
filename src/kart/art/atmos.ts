import * as THREE from 'three'

/**
 * Height fog with sun glow, for every material at once. Three's own fog is the
 * same colour and depth everywhere; this one pools in valleys, thins with
 * height and warms up towards the sun, which is most of what makes distance
 * look like air. Values are plain objects on purpose: three clones Vector
 * uniforms per material, but shares plain objects, so one write reaches all.
 */
export const atmos = {
  /** density, base height, falloff per metre, sun glow strength */
  params: { x: 0.001, y: 0, z: 0.012, w: 0.8 },
  sun: { x: 0, y: 1, z: 0 },
  tint: { x: 1, y: 0.8, z: 0.6 },
  /** Strength of dancing light on every surface, and its clock. */
  caustic: { x: 0, y: 0 },
}

/** Shared clock for wind, water and anything else that sways. */
export const windClock = { value: 0 }

let installed = false

export function installAtmosphere(): void {
  if (installed) return
  installed = true
  const C = THREE.ShaderChunk as unknown as Record<string, string>
  C['fog_pars_vertex'] = /* glsl */ `
    #ifdef USE_FOG
      varying vec3 vFogW;
    #endif`
  C['fog_vertex'] = /* glsl */ `
    #ifdef USE_FOG
      vFogW = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
    #endif`
  C['fog_pars_fragment'] = /* glsl */ `
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vFogW;
      uniform vec4 uAtmos;
      uniform vec3 uAtmosSun;
      uniform vec3 uAtmosTint;
      uniform vec2 uCaustic;
      float causticWeb(vec2 p) {
        vec2 q = p;
        float c = 0.0;
        for (int i = 0; i < 2; i++) {
          float t = uCaustic.y * (0.55 + float(i) * 0.21);
          q += vec2(sin(q.y * 1.3 + t), cos(q.x * 1.1 - t * 0.8)) * 0.72;
          c += 1.0 / (abs(sin(q.x * 0.9) * cos(q.y * 0.9)) * 7.0 + 0.32);
        }
        return c / 2.0;
      }
    #endif`
  C['fog_fragment'] = /* glsl */ `
    #ifdef USE_FOG
      if (uCaustic.x > 0.0) gl_FragColor.rgb *= 1.0 + (causticWeb(vFogW.xz * 0.16 + vFogW.y * 0.05) - 0.75) * uCaustic.x;
      vec3 fogRay = vFogW - cameraPosition;
      float fogDist = length(fogRay);
      float fogK = uAtmos.z;
      float fogStart = exp(-fogK * clamp(cameraPosition.y - uAtmos.y, -60.0, 400.0));
      float fogDy = fogK * fogRay.y;
      float fogSpan = abs(fogDy) > 0.002 ? (1.0 - exp(-fogDy)) / fogDy : 1.0;
      float fogAmount = 1.0 - exp(-uAtmos.x * fogStart * fogSpan * fogDist);
      float fogSunAmt = pow(max(dot(fogRay / max(fogDist, 0.001), uAtmosSun), 0.0), 6.0) * uAtmos.w;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uAtmosTint, fogSunAmt), clamp(fogAmount, 0.0, 1.0));
    #endif`
  const L = THREE.ShaderLib as unknown as Record<string, { uniforms: Record<string, unknown> }>
  for (const k of Object.keys(L)) {
    const u = L[k]!.uniforms
    u['uAtmos'] = { value: atmos.params }
    u['uAtmosSun'] = { value: atmos.sun }
    u['uAtmosTint'] = { value: atmos.tint }
    u['uCaustic'] = { value: atmos.caustic }
  }
}

/** Small value-noise kit shared by the road, ground and water shaders. */
export const GLSL_NOISE = /* glsl */ `
  float aHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float aNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(aHash(i), aHash(i + vec2(1, 0)), f.x), mix(aHash(i + vec2(0, 1)), aHash(i + vec2(1, 1)), f.x), f.y);
  }
  float aFbm(vec2 p) { return aNoise(p) * 0.55 + aNoise(p * 2.13 + 7.1) * 0.3 + aNoise(p * 4.31 + 3.7) * 0.15; }
`
