import * as THREE from 'three'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import type { TerrainField } from './Terrain'
import type { Track } from '../Track'
import { props, at, type PropName } from './Props'
import {
  biomeGroup, smooth, rng, zoneIndices, rightAt, instanced, trs, canvasTexture, puffTexture, roadSign, besideRoad, RoadIndex,
} from './kit'

const SIGNS: [string, string, string][] = [
  ['HOTEL', '#ff2e88', 'v'], ['RAMEN', '#ffb000', 'v'], ['ARCADE', '#2ee6ff', 'v'], ['CLUB 24', '#b44dff', 'h'],
  ['NOODLES', '#ff5a2e', 'v'], ['PHARMACY', '#2eff7a', 'h'], ['KARAOKE', '#ff2ee0', 'v'], ['CINEMA', '#ffe02e', 'h'],
  ['MOTEL', '#ff3b3b', 'h'], ['SUSHI', '#2ea8ff', 'v'], ['GARAGE', '#ff8a00', 'h'], ['JAZZ BAR', '#c56bff', 'h'],
]

/** Night-time megacity: towers, neon, an elevated highway and a tunnel. */
export class NeonCity implements Biome {
  readonly name = 'city'
  readonly group = biomeGroup('city')
  private readonly rand = rng(5)
  private readonly idx: number[]
  private tunnelIdx = new Set<number>()
  private beacons: THREE.InstancedMesh | null = null
  private holo: { ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; hue: number }[] = []
  private holoT = 0
  private steam: THREE.Sprite[] = []
  private signMats: THREE.MeshStandardMaterial[] = []
  private winShader: { uniforms: Record<string, THREE.IUniform> } | null = null

  constructor(private readonly track: Track) {
    this.idx = zoneIndices(track, 'city')
    for (const i of this.idx) {
      const p = track.samples[i]!
      if (p.x < -95 && p.z > -240 && p.z < -105) this.tunnelIdx.add(i)
    }
  }

  fields(): TerrainField[] {
    return []
  }

  /** City samples inside the tunnel (the night look fades out in there). */
  inTunnel(i: number): boolean {
    return this.tunnelIdx.has(i)
  }

  build(ctx: BuildCtx): void {
    this.buildGround()
    this.buildTowers(ctx.road)
    this.buildHighway()
    this.buildStreetLights()
    this.buildTunnel()
    this.buildSteam()
    this.buildSearchlights()
    const i = this.idx[Math.floor(this.idx.length * 0.03)]!
    this.group.add(besideRoad(this.track, i, 14, roadSign(['NEON CITY', 'NIGHT DISTRICT'], '#14102a', '#ff3fb4')))
  }

  /** Dark wet asphalt streets with pavements and crosswalks. */
  private buildGround(): void {
    const tex = canvasTexture(512, 512, (g, w) => {
      g.fillStyle = '#16171a'
      g.fillRect(0, 0, w, w)
      for (let k = 0; k < 4000; k++) { const v = 20 + Math.random() * 20; g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(Math.random() * w, Math.random() * w, 2, 2) }
      // a block: pavement border, kerb line, crosswalk stripes
      g.fillStyle = '#3a3b3f'
      g.fillRect(0, 0, w, 60); g.fillRect(0, 0, 60, w)
      g.fillStyle = '#9a9a92'
      g.fillRect(0, 60, w, 4); g.fillRect(60, 0, 4, w)
      g.fillStyle = '#d8d8d0'
      for (let k = 0; k < 8; k++) g.fillRect(90 + k * 22, 70, 12, 70)
      g.fillStyle = '#c9a400'
      for (let y = 160; y < w; y += 46) g.fillRect(w * 0.6, y, 6, 26)
    })
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(24, 14)
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.32, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 })
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(700, 400), mat)
    plane.rotation.x = -Math.PI / 2
    plane.position.set(60, 0.03, -300)
    plane.receiveShadow = true
    this.group.add(plane)
  }

  /** Instanced towers with procedural lit windows; neon signs on the fronts. */
  private buildTowers(road: RoadIndex): void {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.55, emissive: 0xffffff })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms['uTime'] = { value: 0 }
      this.winShader = shader
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCW;\nvarying vec3 vCN;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 cw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            cw = instanceMatrix * cw;
          #endif
          vCW = (modelMatrix * cw).xyz;
          vCN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCW;
          varying vec3 vCN;
          uniform float uTime;
          float ch(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          float winLit = 0.0;
          vec3 winCol = vec3(0.0);`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            // window grid in world metres: 3.4 m floors, 2.6 m bays
            vec3 an = abs(vCN);
            vec2 f = an.x > an.z ? vec2(vCW.z, vCW.y) : vec2(vCW.x, vCW.y);
            if (an.y > 0.5) f = vec2(-1.0);
            vec2 cell = floor(f / vec2(1.8, 3.4));
            vec2 fr = fract(f / vec2(1.8, 3.4));
            float pane = step(0.2, fr.x) * step(fr.x, 0.8) * step(0.3, fr.y) * step(fr.y, 0.8);
            if (an.y > 0.5) pane = 0.0;
            float r = ch(vec3(cell, floor(vCW.x * 0.02) + floor(vCW.z * 0.02) * 7.0));
            // whole floors go dark in places, like real office blocks at night
            float floorOn = step(0.35, ch(vec3(cell.y, floor(vCW.x * 0.02), floor(vCW.z * 0.02))));
            winLit = pane * step(0.62, r) * floorOn * step(1.5, vCW.y);
            winCol = mix(vec3(1.0, 0.72, 0.42), vec3(0.62, 0.82, 1.0), step(0.7, r));
            winCol = mix(winCol, vec3(1.0, 0.35, 0.8), step(0.95, r));
            diffuseColor.rgb = mix(diffuseColor.rgb * 0.35, vec3(0.08, 0.1, 0.13), pane);
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08, winLit);')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          totalEmissiveRadiance = winCol * winLit * 0.75;`)
    }
    const box = new THREE.BoxGeometry(1, 1, 1)
    box.translate(0, 0.5, 0)
    const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = []
    const roofs: THREE.Matrix4[] = [], masts: THREE.Matrix4[] = [], beacons: THREE.Matrix4[] = []
    const fronts: { p: THREE.Vector3; n: THREE.Vector3; h: number; w: number }[] = []
    const tunnelP = [...this.tunnelIdx].map((i) => this.track.samples[i]!)
    const frontRow: Partial<Record<PropName, THREE.Matrix4[]>> = {}
    for (let x = -250; x <= 360; x += 26) {
      for (let z = -440; z <= -140; z += 26) {
        const cx = x + (this.rand() - 0.5) * 6, cz = z + (this.rand() - 0.5) * 6
        const w = 13 + this.rand() * 9, d = 13 + this.rand() * 9
        const near = road.nearest(cx, cz, 60)
        if (near.i >= 0 && near.d < 17 + Math.max(w, d) / 2) continue
        if (tunnelP.some((p) => Math.hypot(p.x - cx, p.z - cz) < 30)) continue
        // nothing city-like beside the canyon, the town or the jungle
        const zone = road.nearest(cx, cz, 140)
        if (zone.i >= 0 && this.track.zoneOfSample(zone.i) !== 'city') continue
        // the town is north: keep its skyline clear at the edge
        if (cz > -175 && cx > -60) continue
        // street-front blocks are the real city kit; the towers rise behind them
        if (near.i >= 0 && near.d > 24 && near.d < 44) {
          const rp = this.track.samples[near.i]!
          const yaw = Math.atan2(rp.x - cx, rp.z - cz)
          const kit = (['dt:Building_Large_2', 'dt:Building_Medium_2_001', 'dt:Building_Small_1'] as const)[Math.floor(this.rand() * 3)]!
          ;(frontRow[kit] ??= []).push(at(cx, 0, cz, yaw, 1.15))
          continue
        }
        const core = 1 - smooth(60, 320, Math.hypot(cx - 60, cz - 320 + 640))
        const h0 = 18 + Math.pow(this.rand(), 1.6) * (60 + core * 130)
        const tint = new THREE.Color().setHSL(0.6 + this.rand() * 0.1, 0.1, 0.18 + this.rand() * 0.2)
        // a podium, the shaft, and on tall towers one or two setbacks toward
        // the crown, like real high-rises (not one plain box)
        const podium = Math.min(10, h0 * 0.25)
        mats.push(trs(cx, 0, cz, 0, new THREE.Vector3(w + 1.2, podium, d + 1.2)))
        cols.push(tint.clone().multiplyScalar(0.8))
        mats.push(trs(cx, 0, cz, 0, new THREE.Vector3(w, h0, d)))
        cols.push(tint)
        let h = h0, tw = w, td = d
        for (let s = 0; s < (h0 > 110 ? 2 : h0 > 55 ? 1 : 0); s++) {
          tw *= 0.72; td *= 0.72
          const sh = h0 * (0.12 + this.rand() * 0.1)
          mats.push(trs(cx, h, cz, 0, new THREE.Vector3(tw, sh, td)))
          cols.push(tint.clone().offsetHSL(0, 0, 0.03))
          h += sh
        }
        roofs.push(trs(cx + (this.rand() - 0.5) * tw * 0.4, h, cz + (this.rand() - 0.5) * td * 0.4, 0, new THREE.Vector3(tw * 0.35, 2.4, td * 0.35)))
        roofs.push(trs(cx, h, cz, 0, new THREE.Vector3(tw + 0.6, 1.2, td + 0.6)))
        if (h > 60) {
          const mh = 8 + this.rand() * 14
          masts.push(trs(cx, h, cz, 0, new THREE.Vector3(0.4, mh, 0.4)))
          beacons.push(trs(cx, h + mh, cz, 0, 0.7))
        }
        // the face toward the road gets signs
        if (near.i >= 0 && near.d < 80) {
          const rp = this.track.samples[near.i]!
          const dx = rp.x - cx, dz = rp.z - cz
          const n = Math.abs(dx) > Math.abs(dz) ? new THREE.Vector3(Math.sign(dx), 0, 0) : new THREE.Vector3(0, 0, Math.sign(dz))
          const half = n.x !== 0 ? w / 2 : d / 2
          fronts.push({ p: new THREE.Vector3(cx + n.x * (half + 0.75), 0, cz + n.z * (half + 0.75)), n, h: h0, w: n.x !== 0 ? d : w })
        }
      }
    }
    for (const [k, m] of Object.entries(frontRow)) props.place(k as PropName, m!, this.group, { cast: true })
    this.group.add(instanced(box, mat, mats, cols))
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.8 })
    this.group.add(instanced(box, roofMat, roofs))
    this.group.add(instanced(box, new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8 }), masts))
    this.beacons = instanced(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff0000, emissiveIntensity: 4 }), beacons, undefined, false)
    this.group.add(this.beacons)
    this.buildSigns(fronts)
  }

  private buildSigns(fronts: { p: THREE.Vector3; n: THREE.Vector3; h: number; w: number }[]): void {
    const tex = SIGNS.map(([text, color, dir]) => {
      const vert = dir === 'v'
      return canvasTexture(vert ? 128 : 512, vert ? 512 : 160, (g, w, h) => {
        g.fillStyle = '#07060a'
        g.fillRect(0, 0, w, h)
        g.strokeStyle = color
        g.lineWidth = 6
        g.shadowColor = color
        g.shadowBlur = 18
        g.strokeRect(10, 10, w - 20, h - 20)
        g.fillStyle = '#ffffff'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        if (vert) {
          const chars = text.replace(' ', '').split('')
          const step = (h - 50) / chars.length
          g.font = `700 ${Math.min(96, step * 0.95)}px Rajdhani, Arial`
          chars.forEach((c, k) => g.fillText(c, w / 2, 25 + step * (k + 0.5)))
        } else {
          g.font = '700 108px Rajdhani, Arial'
          g.fillText(text, w / 2, h / 2 + 4)
        }
      })
    })
    tex.forEach((t, k) => {
      const m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(SIGNS[k]![1]), emissiveIntensity: 3.2, roughness: 0.5 })
      this.signMats.push(m)
    })
    for (const f of fronts) {
      if (this.rand() < 0.25) continue
      const k = Math.floor(this.rand() * SIGNS.length)
      const vert = SIGNS[k]![2] === 'v'
      const sw = vert ? 2.6 : Math.min(f.w * 0.8, 12), sh = vert ? 10 : sw * 0.31
      const y = vert ? 6 + this.rand() * Math.max(1, f.h - 20) : 4 + this.rand() * Math.min(20, f.h - 8)
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), this.signMats[k]!)
      const side = (this.rand() - 0.5) * f.w * 0.5
      const tangent = new THREE.Vector3(-f.n.z, 0, f.n.x)
      sign.position.copy(f.p).addScaledVector(tangent, side).setY(y + sh / 2)
      sign.lookAt(sign.position.clone().add(f.n))
      if (vert) {
        // blade signs stick out from the wall
        sign.position.addScaledVector(f.n, 1.4)
        sign.rotateY(Math.PI / 2)
      }
      this.group.add(sign)
    }
    // giant animated screens on four towers by the highway
    const big = fronts.filter((f) => f.h > 70).slice(0, 4)
    for (const f of big) {
      const c = document.createElement('canvas')
      c.width = 384
      c.height = 216
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      const g = c.getContext('2d')!
      this.holo.push({ ctx: g, tex: t, hue: this.rand() * 360 })
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(26, 14.6), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 2.2 }))
      scr.position.copy(f.p).setY(Math.min(f.h - 12, 46))
      scr.lookAt(scr.position.clone().add(f.n))
      scr.position.addScaledVector(f.n, 0.3)
      this.group.add(scr)
    }
  }

  private drawHolo(time: number): void {
    for (const h of this.holo) {
      const g = h.ctx
      const W = 384, H = 216
      const hue = (h.hue + time * 20) % 360
      const gr = g.createLinearGradient(0, 0, W, H)
      gr.addColorStop(0, `hsl(${hue},90%,45%)`)
      gr.addColorStop(1, `hsl(${(hue + 80) % 360},90%,25%)`)
      g.fillStyle = gr
      g.fillRect(0, 0, W, H)
      // speed lines
      g.strokeStyle = 'rgba(255,255,255,0.35)'
      for (let k = 0; k < 14; k++) {
        const y = (k * 37 + time * 140) % H
        g.lineWidth = 1 + (k % 3)
        g.beginPath(); g.moveTo(0, y); g.lineTo(W, y + 30); g.stroke()
      }
      g.fillStyle = '#fff'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = 'italic 800 74px "Barlow Condensed", Arial'
      const x = W / 2 + Math.sin(time * 0.8) * 20
      g.fillText('COSMOS', x, H * 0.42)
      g.font = '700 30px Rajdhani, Arial'
      g.fillText(['DRIVE THE NIGHT', 'NEON CITY', 'OPEN 24/7'][Math.floor(time / 3) % 3]!, W / 2, H * 0.75)
      h.tex.needsUpdate = true
    }
  }

  /** Concrete deck under the raised road, T-piers, barriers. */
  private buildHighway(): void {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x77787a, roughness: 0.9 })
    const half = this.track.width / 2
    const raised = this.idx.filter((i) => this.track.samples[i]!.y > 3.5)
    if (!raised.length) return
    const pos: number[] = [], idx: number[] = []
    const prof: [number, number][] = [[-half - 0.6, 0], [-half - 0.6, -1.6], [half + 0.6, -1.6], [half + 0.6, 0], [half + 0.6, 1.1], [half + 0.2, 1.1], [half + 0.2, 0.02]]
    const profL: [number, number][] = [[-half - 0.2, 0.02], [-half - 0.2, 1.1], [-half - 0.6, 1.1], [-half - 0.6, 0]]
    const strip = (p2: [number, number][]) => {
      const base = pos.length / 3
      raised.forEach((i, k) => {
        const p = this.track.samples[i]!, r = rightAt(this.track, i)
        for (const [a, h] of p2) pos.push(p.x + r.x * a, p.y + h, p.z + r.z * a)
        if (k > 0 && raised[k - 1] === i - 1) {
          const R = p2.length, b = base + k * R, a0 = b - R
          for (let j = 0; j < R - 1; j++) idx.push(a0 + j, b + j, a0 + j + 1, a0 + j + 1, b + j, b + j + 1)
        }
      })
    }
    strip(prof)
    strip(profL)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    const deck = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x77787a, roughness: 0.9, side: THREE.DoubleSide }))
    deck.castShadow = true
    deck.receiveShadow = true
    this.group.add(deck)
    const col = new THREE.CylinderGeometry(1.3, 1.5, 1, 12)
    col.translate(0, 0.5, 0)
    const cap = new THREE.BoxGeometry(16, 1.6, 3)
    const cols: THREE.Matrix4[] = [], caps: THREE.Matrix4[] = []
    for (let k = 0; k < raised.length; k += 24) {
      const i = raised[k]!
      const p = this.track.samples[i]!, tg = this.track.tangents[i]!
      const top = p.y - 1.6
      cols.push(trs(p.x, 0, p.z, 0, new THREE.Vector3(1, top - 0.8, 1)))
      caps.push(trs(p.x, top - 0.8, p.z, Math.atan2(-tg.x, -tg.z)))
    }
    this.group.add(instanced(col, concrete, cols), instanced(cap, concrete, caps))
  }

  private buildStreetLights(): void {
    const pole = new THREE.CylinderGeometry(0.12, 0.16, 1, 6)
    pole.translate(0, 0.5, 0)
    const head = new THREE.BoxGeometry(1.6, 0.2, 0.5)
    const poles: THREE.Matrix4[] = [], heads: THREE.Matrix4[] = []
    for (let k = 0; k < this.idx.length; k += 16) {
      const i = this.idx[k]!
      if (this.tunnelIdx.has(i)) continue
      const p = this.track.samples[i]!, r = rightAt(this.track, i), tg = this.track.tangents[i]!
      const s = k % 32 ? 1 : -1
      const x = p.x + r.x * s * 11.2, z = p.z + r.z * s * 11.2
      poles.push(trs(x, p.y, z, 0, new THREE.Vector3(1, 9, 1)))
      heads.push(trs(x - r.x * s * 0.9, p.y + 9, z - r.z * s * 0.9, Math.atan2(tg.x, tg.z)))
    }
    this.group.add(instanced(pole, new THREE.MeshStandardMaterial({ color: 0x404448, metalness: 0.7, roughness: 0.4 }), poles))
    this.group.add(instanced(head, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xbfe0ff, emissiveIntensity: 3 }), heads, undefined, false))
  }

  /** Cut-and-cover tunnel: tiled walls, sodium lights, jet fans. */
  private buildTunnel(): void {
    const ids = [...this.tunnelIdx].sort((a, b) => a - b)
    if (ids.length < 4) return
    const half = this.track.width / 2 + 3
    const H = 8.5
    const tiles = canvasTexture(256, 256, (g, w) => {
      g.fillStyle = '#d9dcd6'
      g.fillRect(0, 0, w, w)
      g.strokeStyle = '#a8aba5'
      g.lineWidth = 2
      for (let k = 0; k <= 8; k++) { g.beginPath(); g.moveTo(0, k * 32); g.lineTo(w, k * 32); g.stroke(); g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32, w); g.stroke() }
      g.fillStyle = '#e8b400'
      g.fillRect(0, w - 40, w, 14)
    })
    tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping
    const inner = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.5, side: THREE.BackSide })
    const outer = new THREE.MeshStandardMaterial({ color: 0x6e7166, roughness: 0.95 })
    const grass = new THREE.MeshStandardMaterial({ color: 0x4d6b33, roughness: 1 })
    const build = (prof: [number, number][], mat: THREE.Material, uvScale = 1) => {
      const pos: number[] = [], uv: number[] = [], idx: number[] = []
      let along = 0
      ids.forEach((i, k) => {
        const p = this.track.samples[i]!, r = rightAt(this.track, i)
        if (k > 0) along += p.distanceTo(this.track.samples[ids[k - 1]!]!)
        prof.forEach(([a, h], q) => { pos.push(p.x + r.x * a, p.y + h, p.z + r.z * a); uv.push(q / (prof.length - 1) * 4 * uvScale, along / 8) })
        if (k > 0) {
          const R = prof.length, b = k * R, a0 = b - R
          for (let j = 0; j < R - 1; j++) idx.push(a0 + j, a0 + j + 1, b + j, a0 + j + 1, b + j + 1, b + j)
        }
      })
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      g.setIndex(idx)
      g.computeVertexNormals()
      const m = new THREE.Mesh(g, mat)
      m.castShadow = true
      m.receiveShadow = true
      this.group.add(m)
    }
    build([[-half, -0.2], [-half, H - 1.2], [-half + 1.4, H], [half - 1.4, H], [half, H - 1.2], [half, -0.2]], inner)
    build([[-half - 1.2, -0.3], [-half - 1.2, H + 1], [half + 1.2, H + 1], [half + 1.2, -0.3]], outer)
    build([[-half - 6, -0.2], [-half - 1, H + 1.6], [half + 1, H + 1.6], [half + 6, -0.2]], grass)
    // sodium light strip and jet fans
    const lamp = new THREE.BoxGeometry(0.5, 0.15, 2.4)
    const fan = new THREE.CylinderGeometry(0.8, 0.8, 4, 14)
    fan.rotateX(Math.PI / 2)
    const lamps: THREE.Matrix4[] = [], fans: THREE.Matrix4[] = []
    ids.forEach((i, k) => {
      const p = this.track.samples[i]!, r = rightAt(this.track, i), tg = this.track.tangents[i]!
      const yaw = Math.atan2(tg.x, tg.z)
      if (k % 5 === 0) for (const s of [-1, 1]) lamps.push(trs(p.x + r.x * s * 6, p.y + H - 0.1, p.z + r.z * s * 6, yaw))
      if (k % 70 === 35) for (const s of [-1, 1]) fans.push(trs(p.x + r.x * s * 4, p.y + H - 1.3, p.z + r.z * s * 4, yaw))
    })
    this.group.add(instanced(lamp, new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xff9a2e, emissiveIntensity: 3.5 }), lamps, undefined, false))
    this.group.add(instanced(fan, new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 0.7, roughness: 0.4 }), fans))
    // portal sign
    const i0 = ids[0]!
    const p0 = this.track.samples[i0]!, t0 = this.track.tangents[i0]!
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.6), new THREE.MeshStandardMaterial({
      map: canvasTexture(512, 68, (g, w, h) => {
        g.fillStyle = '#0e3a6e'; g.fillRect(0, 0, w, h)
        g.fillStyle = '#fff'; g.font = '700 48px Rajdhani, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'
        g.fillText('HARBOUR TUNNEL  ·  TOWN CENTRE', w / 2, h / 2 + 2)
      }),
    }))
    sign.position.copy(p0).setY(p0.y + H + 0.6)
    sign.rotation.y = Math.atan2(-t0.x, -t0.z)
    sign.position.addScaledVector(t0, -0.8)
    this.group.add(sign)
  }

  /** Sweeping beams from the rooftops, the city's skyline signature. */
  private buildSearchlights(): void {
    const geo = new THREE.ConeGeometry(14, 420, 20, 1, true)
    geo.translate(0, -210, 0) // apex at the origin, opening upward after the flip
    geo.rotateX(Math.PI)
    const cols = [0xff2fd0, 0x2fe6ff, 0xffffff, 0xb44dff]
    for (let k = 0; k < 7; k++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: cols[k % 4], transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }))
      m.position.set(-120 + k * 62 + (this.rand() - 0.5) * 30, 70, -300 + (this.rand() - 0.5) * 90)
      m.userData['ph'] = this.rand() * 6
      this.beams.push(m)
      this.group.add(m)
    }
  }
  private beams: THREE.Mesh[] = []

  private buildSteam(): void {
    for (let k = 0; k < 10; k++) {
      const i = this.idx[Math.floor(this.rand() * this.idx.length)]!
      const p = this.track.samples[i]!, r = rightAt(this.track, i)
      const off = (this.rand() < 0.5 ? -1 : 1) * (16 + this.rand() * 30)
      for (let q = 0; q < 4; q++) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: 0xcfd6e0, transparent: true, depthWrite: false, opacity: 0.35 }))
        s.userData['base'] = new THREE.Vector3(p.x + r.x * off, 0, p.z + r.z * off)
        s.userData['phase'] = q / 4
        this.steam.push(s)
        this.group.add(s)
      }
    }
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    if (this.winShader) this.winShader.uniforms['uTime']!.value = f.time
    if (!this.group.visible) return
    if (this.beacons) this.beacons.visible = Math.sin(f.time * 3) > 0
    for (const b of this.beams) {
      const ph = b.userData['ph'] as number
      // only over the city, not across the desert
      const far = b.position.distanceTo(f.camera.position)
      ;(b.material as THREE.MeshBasicMaterial).opacity = 0.09 * (1 - THREE.MathUtils.smoothstep(far, 500, 850))
      b.visible = far < 850
      b.rotation.x = Math.sin(f.time * 0.35 + ph) * 0.42
      b.rotation.z = Math.cos(f.time * 0.27 + ph * 1.7) * 0.42
    }
    this.holoT += f.dt
    if (this.holoT > 0.08) { this.holoT = 0; this.drawHolo(f.time) }
    for (const m of this.signMats) m.emissiveIntensity = 3 + Math.sin(f.time * 7 + m.id) * 0.25 * (Math.sin(f.time * 31 + m.id) > 0.97 ? 6 : 1)
    for (const s of this.steam) {
      const ph = (s.userData['phase'] as number + f.time * 0.15) % 1
      const b = s.userData['base'] as THREE.Vector3
      s.position.set(b.x + ph * 2, 0.5 + ph * 10, b.z)
      s.scale.setScalar(2 + ph * 7)
      ;(s.material as THREE.SpriteMaterial).opacity = 0.35 * (1 - ph) * smooth(0, 0.1, ph)
    }
    void ev
  }
}
