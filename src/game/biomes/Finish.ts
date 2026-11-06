import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Biome, BiomeEvents, BuildCtx, FrameCtx } from './types'
import type { TerrainField } from './Terrain'
import type { Track } from '../Track'
import { biomeGroup, canvasTexture, instanced, rightAt, rng, softDot, trs } from './kit'

const CONFETTI = 1100
const SHUTTERS = 60
const SHELLS = 7
const SPARKS = 70

/** The finish straight: packed grandstands, camera flashes and confetti. */
export class Stadium implements Biome {
  readonly name = 'coast'
  readonly group = biomeGroup('coast')
  private readonly rand = rng(303)
  private confetti: THREE.Points | null = null
  private confettiPos = new Float32Array(CONFETTI * 3)
  private confettiSeed = new Float32Array(CONFETTI * 3)
  private shutters: THREE.Sprite[] = []
  private centre = new THREE.Vector3()
  private fw: THREE.Points | null = null
  private readonly fwPos = new Float32Array(SHELLS * SPARKS * 3)
  private readonly fwVel = new Float32Array(SHELLS * SPARKS * 3)
  private readonly fwCol = new Float32Array(SHELLS * SPARKS * 3)
  private readonly fwBase = new Float32Array(SHELLS * 3)
  private readonly fwAge = new Float32Array(SHELLS).fill(9)
  private party = 0
  private nextShell = 0
  private screen: { c: HTMLCanvasElement; tex: THREE.CanvasTexture } | null = null
  private cheered = false
  private crowd: THREE.InstancedMesh | null = null
  private readonly crowdU = { uTime: { value: 0 }, uExcite: { value: 0.25 } }

  constructor(private readonly track: Track) {}

  fields(): TerrainField[] {
    return []
  }

  build(ctx: BuildCtx): void {
    void ctx
    const t = this.track, n = t.sampleCount
    const concrete: THREE.Matrix4[] = [], fans: THREE.Matrix4[] = [], fanCol: THREE.Color[] = []
    const shirts = [0xff2f6a, 0xffffff, 0x35d0ff, 0xffc22e, 0x7a4dff, 0x1e2230]
    const TIERS = 11, START = 17
    const seats: THREE.Vector3[] = []
    // the bowl wraps the run-in and carries on past the line
    for (let q = -150; q < 54; q += 3) {
      const k = (q + n) % n
      const p = t.samples[k]!, r = rightAt(t, k), tg = t.tangents[k]!
      const yaw = Math.atan2(tg.x, tg.z)
      for (const side of [-1, 1]) {
        for (let q = 0; q < TIERS; q++) {
          const lat = side * (START + q * 1.9), y = p.y + q * 1.25
          // each tier's top sits just under its own row of fans
          const tall = q * 1.25 + 3
          concrete.push(trs(p.x + r.x * lat, y + 0.1 - tall / 2, p.z + r.z * lat, yaw, new THREE.Vector3(2.1, tall, 5.4)))
          for (let f = 0; f < 3; f++) {
            const x = p.x + r.x * lat + tg.x * (f - 1) * 1.5 + (this.rand() - 0.5) * 0.5, z = p.z + r.z * lat + tg.z * (f - 1) * 1.5 + (this.rand() - 0.5) * 0.5
            // facing the track, a little different in height
            fans.push(trs(x, y + 0.1, z, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2) + (this.rand() - 0.5) * 0.7, 0.92 + this.rand() * 0.2))
            fanCol.push(new THREE.Color(shirts[Math.floor(this.rand() * shirts.length)]!))
            if (this.rand() < 0.1) seats.push(new THREE.Vector3(x, y + 1.3, z))
          }
        }
      }
    }
    this.group.add(instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3a3f4d, roughness: 0.8 }), concrete))
    this.crowd = instanced(fanGeometry(), this.crowdMaterial(), fans, fanCol, false)
    this.crowd.frustumCulled = false
    this.group.add(this.crowd)

    const dot = softDot()
    for (let k = 0; k < SHUTTERS; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
      s.position.copy(seats[Math.floor(this.rand() * seats.length)]!)
      s.userData['ph'] = this.rand() * 40
      this.shutters.push(s)
      this.group.add(s)
    }

    this.centre.copy(t.samples[n - 12]!)
    this.buildTowers()
    this.buildScreen()
    this.buildFireworks()
    const cols = new Float32Array(CONFETTI * 3)
    const palette = shirts.slice(0, 5).map((c) => new THREE.Color(c))
    for (let k = 0; k < CONFETTI; k++) {
      this.confettiSeed.set([(this.rand() - 0.5) * 90, this.rand() * 34, (this.rand() - 0.5) * 90], k * 3)
      const c = palette[k % palette.length]!
      cols.set([c.r, c.g, c.b], k * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.confettiPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    this.confetti = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, fog: false }))
    this.confetti.frustumCulled = false
    this.group.add(this.confetti)
  }

  /** Each fan jumps and throws their arms up on their own beat, more as you near the line. */
  private crowdMaterial(): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })
    mat.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, this.crowdU)
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aSkin;
          attribute float aArm;
          uniform float uTime, uExcite;
          varying float vSkin;
          varying float vTone;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float seed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          float beat = max(0.0, sin(uTime * (3.0 + seed * 3.0) + seed * 40.0));
          float hop = beat * beat * uExcite;
          transformed.y += hop * 0.5 + aArm * (0.15 + hop * 0.5);
          vSkin = aSkin;
          vTone = seed;`)
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSkin;\nvarying float vTone;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb = vSkin < -0.5 ? vec3(0.05, 0.06, 0.09) : mix(diffuseColor.rgb, mix(vec3(0.28, 0.16, 0.1), vec3(0.85, 0.62, 0.48), vTone), vSkin);`)
    }
    return mat
  }

  /** Floodlight masts round the bowl: they announce the stadium from far off. */
  private buildTowers(): void {
    const t = this.track, n = t.sampleCount
    const steel = new THREE.MeshStandardMaterial({ color: 0x20232c, metalness: 0.7, roughness: 0.4 })
    const dot = softDot()
    for (const q of [-150, -95, -40, 15, 50]) {
      const k = (q + n) % n
      const p = t.samples[k]!, r = rightAt(t, k)
      for (const side of [-1, 1]) {
        const x = p.x + r.x * side * 42, z = p.z + r.z * side * 42
        const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 44, 8), steel)
        mast.position.set(x, p.y + 22, z)
        const head = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 2.6), toneMapped: false }))
        head.position.set(x, p.y + 45, z)
        head.rotation.y = Math.atan2(r.x, r.z)
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, color: 0xfff4dc, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
        halo.position.copy(head.position)
        halo.scale.setScalar(30)
        this.group.add(mast, head, halo)
      }
    }
  }

  /** The giant screen over the run-in; it shows your time at the finish. */
  private buildScreen(): void {
    const t = this.track, n = t.sampleCount, k = n - 34
    const p = t.samples[k]!, tg = t.tangents[k]!, r = rightAt(t, k)
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 256
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    this.screen = { c, tex }
    this.setScreen('NITRO COSMOS', 'FINISH')
    const face = new THREE.Mesh(new THREE.PlaneGeometry(38, 9.5), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }))
    face.position.set(p.x, p.y + 16.5, p.z)
    face.rotation.y = Math.atan2(-tg.x, -tg.z)
    this.group.add(face)
    const steel = new THREE.MeshStandardMaterial({ color: 0x14161f, metalness: 0.6, roughness: 0.4 })
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1, 21, 1), steel)
      leg.position.set(p.x + r.x * s * 19.5, p.y + 10.5, p.z + r.z * s * 19.5)
      this.group.add(leg)
    }
  }

  setScreen(big: string, small: string, color = '#25d9ff'): void {
    if (!this.screen) return
    const { c, tex } = this.screen, g = c.getContext('2d')!
    g.fillStyle = '#05060c'
    g.fillRect(0, 0, c.width, c.height)
    g.strokeStyle = color
    g.lineWidth = 8
    g.strokeRect(10, 10, c.width - 20, c.height - 20)
    g.textAlign = 'center'
    g.fillStyle = color
    g.font = '700 46px Rajdhani, Arial, sans-serif'
    g.fillText(small, c.width / 2, 70)
    g.fillStyle = '#fff'
    g.font = '800 124px Rajdhani, Arial, sans-serif'
    g.fillText(big, c.width / 2, 196, c.width - 60)
    tex.needsUpdate = true
  }

  private buildFireworks(): void {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.fwPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.fwCol, 3))
    this.fw = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.5, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }))
    this.fw.frustumCulled = false
    this.fw.visible = false
    this.group.add(this.fw)
  }

  /** Fireworks and flashes for this many seconds. */
  celebrate(seconds: number): void {
    this.party = Math.max(this.party, seconds)
    this.nextShell = 0
  }

  /** New race: back to the idle screen and a crowd waiting to cheer. */
  rearm(): void {
    this.cheered = false
    this.party = 0
    this.setScreen('NITRO COSMOS', 'FINISH')
  }

  private updateFireworks(f: FrameCtx, ev: BiomeEvents): void {
    if (!this.fw) return
    this.party = Math.max(0, this.party - f.dt)
    this.nextShell -= f.dt
    if (this.party > 0 && this.nextShell <= 0) {
      this.nextShell = 0.3 + this.rand() * 0.45
      const s = this.fwAge.findIndex((a) => a > 2.2)
      if (s >= 0) {
        this.fwAge[s] = 0
        const c = this.centre
        this.fwBase.set([c.x + (this.rand() - 0.5) * 130, c.y + 42 + this.rand() * 38, c.z + (this.rand() - 0.5) * 130], s * 3)
        const hue = new THREE.Color().setHSL(this.rand(), 1, 0.6).multiplyScalar(3)
        for (let k = 0; k < SPARKS; k++) {
          const o = (s * SPARKS + k) * 3
          const y = this.rand() * 2 - 1, a = this.rand() * 6.283, h = Math.sqrt(1 - y * y), v = 15 + this.rand() * 7
          this.fwPos.set([this.fwBase[s * 3]!, this.fwBase[s * 3 + 1]!, this.fwBase[s * 3 + 2]!], o)
          this.fwVel.set([Math.cos(a) * h * v, y * v, Math.sin(a) * h * v], o)
          this.fwCol.set([hue.r, hue.g, hue.b], o)
        }
        ev.loop('crowd', 1)
        ev.sfx('firework', 0.5)
      }
    }
    let live = false
    for (let s = 0; s < SHELLS; s++) {
      if (this.fwAge[s]! > 2.2) continue
      live = true
      this.fwAge[s]! += f.dt
      const fade = Math.pow(0.28, f.dt), drag = Math.pow(0.45, f.dt)
      for (let k = 0; k < SPARKS; k++) {
        const o = (s * SPARKS + k) * 3
        this.fwVel[o]! *= drag; this.fwVel[o + 2]! *= drag
        this.fwVel[o + 1] = this.fwVel[o + 1]! * drag - 7 * f.dt
        for (let q = 0; q < 3; q++) { this.fwPos[o + q]! += this.fwVel[o + q]! * f.dt; this.fwCol[o + q]! *= fade }
      }
    }
    this.fw.visible = live
    if (live) {
      this.fw.geometry.getAttribute('position').needsUpdate = true
      this.fw.geometry.getAttribute('color').needsUpdate = true
    }
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    if (!this.confetti) return
    const n = this.track.sampleCount
    const near = f.carIdx > n - 280 || f.carIdx < 40
    // the crowd swells from a long way out and peaks through the bowl
    const to = f.carIdx > n / 2 ? n - f.carIdx : f.carIdx
    ev.loop('crowd', Math.max(0, 1 - to / 620) ** 1.6)
    if (to < 240 && f.carIdx > n / 2 && !this.cheered) { this.cheered = true; ev.sfx('cheer', 0.8) }
    this.updateFireworks(f, ev)
    this.confetti.visible = near
    if (this.crowd) {
      this.crowd.visible = near || f.carIdx > n - 420 || f.carIdx < 130
      this.crowdU.uTime.value = f.time % 1000
      const hype = this.party > 0 ? 1 : Math.max(0.2, 1 - to / 500)
      this.crowdU.uExcite.value += (hype - this.crowdU.uExcite.value) * Math.min(1, f.dt * 2)
    }
    for (const s of this.shutters) {
      const on = near && (f.time + (s.userData['ph'] as number)) % (this.party > 0 ? 0.9 : 2.6) < 0.09
      ;(s.material as THREE.SpriteMaterial).opacity = on ? 1 : 0
      s.scale.setScalar(on ? 2.6 : 0.01)
    }
    if (!near) return
    const c = this.centre, s = this.confettiSeed, p = this.confettiPos
    for (let k = 0; k < CONFETTI; k++) {
      const o = k * 3, y = (s[o + 1]! - f.time * (3 + (k % 5))) % 34
      p[o] = c.x + s[o]! + Math.sin(f.time * 1.4 + k) * 1.6
      p[o + 1] = c.y + (y < 0 ? y + 34 : y)
      p[o + 2] = c.z + s[o + 2]! + Math.cos(f.time * 1.1 + k) * 1.6
    }
    ;(this.confetti.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
  }
}

/** One fan: legs and body, a head, and arms that go up. Low detail, there are thousands. */
function fanGeometry(): THREE.BufferGeometry {
  const tag = (g: THREE.BufferGeometry, skin: number, arm: number): THREE.BufferGeometry => {
    const n = g.getAttribute('position').count
    g.setAttribute('aSkin', new THREE.BufferAttribute(new Float32Array(n).fill(skin), 1))
    g.setAttribute('aArm', new THREE.BufferAttribute(new Float32Array(n).fill(arm), 1))
    return g
  }
  const legs = new THREE.CylinderGeometry(0.17, 0.13, 0.62, 6, 1).translate(0, 0.31, 0)
  const body = new THREE.CylinderGeometry(0.15, 0.18, 0.56, 6, 1).translate(0, 0.88, 0)
  const head = new THREE.SphereGeometry(0.17, 7, 6).translate(0, 1.36, 0)
  const left = new THREE.CylinderGeometry(0.055, 0.055, 0.66, 4, 1).rotateZ(0.42).translate(-0.3, 1.32, 0)
  const right = new THREE.CylinderGeometry(0.055, 0.055, 0.66, 4, 1).rotateZ(-0.42).translate(0.3, 1.32, 0)
  return mergeGeometries([tag(legs, -1, 0), tag(body, 0, 0), tag(head, 1, 0), tag(left, 1, 1), tag(right, 1, 1)], false)!
}

const MEDAL_COLOR: Record<string, number> = { GOLD: 0xf7c23c, SILVER: 0xd9dee6, BRONZE: 0xc9743e }

/** The prize: a spinning comet cup on a lit plinth, cast in the medal's metal. */
export class Trophy {
  readonly group = new THREE.Group()
  private readonly metal = new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 1, roughness: 0.22, emissive: 0x241a10 })
  private readonly spin = new THREE.Group()

  constructor() {
    this.group.visible = false
    const profile = [[0.05, 0], [1.05, 0], [1.05, 0.2], [0.42, 0.42], [0.22, 1.1], [0.32, 1.45], [0.95, 1.9], [1.22, 3.05], [1.13, 3.05], [0.82, 2.0], [0.05, 1.8]]
    const cup = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([x, y]) => new THREE.Vector2(x, y)), 40), this.metal)
    this.spin.add(cup)
    for (const s of [-1, 1]) {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 10, 26, Math.PI * 1.15), this.metal)
      handle.position.set(s * 1.28, 2.42, 0)
      handle.rotation.z = s > 0 ? -1.75 : 1.2
      this.spin.add(handle)
    }
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.46, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 3), toneMapped: false }))
    star.position.y = 3.7
    star.scale.y = 1.5
    this.spin.add(star)
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.035, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.2, 3), toneMapped: false }))
    orbit.position.y = 3.3
    orbit.rotation.x = 1.25
    this.spin.add(orbit)
    this.spin.position.y = 1
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 1, 32), new THREE.MeshStandardMaterial({ color: 0x14161f, metalness: 0.5, roughness: 0.35 }))
    plinth.position.y = 0.5
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.5, 1.6), toneMapped: false }))
    halo.rotation.x = Math.PI / 2
    halo.position.y = 1.03
    this.group.add(plinth, halo, this.spin)
    this.group.traverse((o) => { o.frustumCulled = false })
  }

  private rise = 0
  private readonly home = new THREE.Vector3()

  show(at: THREE.Vector3, medal: string | null): void {
    this.metal.color.set(medal ? MEDAL_COLOR[medal]! : 0x8c95a3)
    this.home.copy(at)
    this.group.position.copy(at).setY(at.y - 6)
    this.rise = 0
    this.group.visible = true
  }

  hide(): void {
    this.group.visible = false
  }

  update(dt: number): void {
    this.spin.rotation.y += dt * 0.9
    // lifts out of the ground on its plinth
    this.rise = Math.min(1, this.rise + dt / 1.5)
    const e = 1 - Math.pow(1 - this.rise, 3)
    this.group.position.y = this.home.y - 6 * (1 - e)
  }
}
