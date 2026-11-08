import * as THREE from 'three'
import { canvasTexture, fbm2, lumpy, smooth, softDot, trs } from '../../game/biomes/kit'
import { Mesher, place, surface } from '../art/arch'
import { forest, grass } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef } from '../types'
import { arrows, crates, drift, gantry, glow, glowStreak, mist, stands } from './parts'

/** The house: main block, the hall the road climbs through, and the east wing. */
const HOUSE = { x0: -55, x1: 55, z0: -230, z1: -170, wall: 30 }
const WING = { x0: 55, x1: 98, z0: -216, z1: -184, top: 17.4 }
const HALL_Z = -200
const inHouse = (x: number, z: number, pad = 0) => x > HOUSE.x0 - pad && x < WING.x1 + pad && z > HOUSE.z0 - pad && z < HOUSE.z1 + pad

/** A dim oil portrait in a gilt frame. */
function portraitTexture(seed: number): THREE.CanvasTexture {
  return canvasTexture(64, 80, (g, W, H) => {
    g.fillStyle = '#6a4a1a'
    g.fillRect(0, 0, W, H)
    g.fillStyle = ['#1a1410', '#141a14', '#1a1418'][seed % 3]!
    g.fillRect(6, 6, W - 12, H - 12)
    g.fillStyle = '#3a2a22'
    g.beginPath(); g.ellipse(W / 2, H * 0.42, 11, 14, 0, 0, 6.3); g.fill()
    g.fillStyle = '#c8a888'
    g.beginPath(); g.ellipse(W / 2, H * 0.4, 7, 9, 0, 0, 6.3); g.fill()
    g.fillStyle = '#20181a'
    g.fillRect(W / 2 - 14, H * 0.56, 28, H * 0.4)
  })
}

/**
 * Hollow Manor: up the drive, in through the west door, and up the ramp that
 * climbs the length of the great hall under the chandeliers. Out through the
 * east wall onto the wing's roof terrace and off the end of it, down into the
 * graveyard; then the hedge lane and the lake shore. The storm breaks on the
 * second lap; by the last, the house's old residents are out on the road.
 */
export const manor: TrackDef = {
  id: 'manor',
  name: 'Hollow Manor',
  ambience: 'snow',
  width: 15,
  bank: 2.2,
  shoulder: 8,
  accent: 0x8a7ad0,
  sea: -1.2,
  water: { deep: 0x060a10, shallow: 0x1a2428, foam: 0x8a9a9a, waves: 0.3 },
  rails: 'wood',
  piers: 'none',
  road: { lines: 'plain', grime: 0x3a3830, tone: 0.8, sheen: 0.3, kerb: false },
  terrain: { layers: ['grass', 'brown_mud_leaves_01', 'rock_pitted_mossy', 'forest_floor'], tile: [22, 9, 20, 12], tints: [0x6a7058, 0x7a6a58, 0x7a7a74, 0x6a6450] },
  look: {
    tod: 'night', generatedSky: true, top: [0.02, 0.025, 0.05], horizon: [0.12, 0.14, 0.22], mix: 0.9, stars: 0.6,
    fog: [0.1, 0.11, 0.16], fogDensity: 0.0024, fogBase: 6, fogFall: 0.03, sunGlow: 0.2,
    exposure: 1.45, sun: 1.1, hemi: 1.2, bloom: 0.5, wet: 0.4, headlights: 1, env: 0.6,
    grade: [0.92, 1.12, 0.006, 0.008, 0.02, 0.98, 1.0, 1.08, 0.42],
  },
  points: [
    [0, 2, 0],
    [-90, 2, -6, { pad: 0 }],
    [-162, 3, -48],
    [-198, 4, -120],
    [-162, 5, -188],
    [-100, 6, -200, { deck: 'wood' }],
    [-58, 6, HALL_Z, { raised: true, deck: 'wood', rail: '' }],
    [-18, 9.5, HALL_Z, { raised: true, deck: 'wood', rail: '' }],
    [22, 13.6, HALL_Z, { raised: true, deck: 'wood', rail: '', pad: 0 }],
    [56, 17.6, HALL_Z, { raised: true, deck: 'wood', rail: '' }],
    [94, 18, HALL_Z, { raised: true, deck: 'steel', rail: '' }],
    [130, 16, -198, { gap: true }],
    [170, 3, -186, { w: 22 }],
    [204, 3, -134],
    [194, 3, -70],
    [228, 2, -12],
    [200, 2, 58],
    [124, 2, 70],
    [58, 2, 30],
  ],
  ground(x, z) {
    const hill = 6 * smooth(260, 60, Math.hypot(x, z + 200))
    const lake = Math.max(0, 1 - Math.hypot((x - 60) / 120, (z - 160) / 70))
    const far = smooth(380, 700, Math.hypot(x, z + 80)) * (20 + fbm2(x * 0.006, z * 0.006) * 70)
    return fbm2(x * 0.02, z * 0.02) * 1.4 + hill + far - lake * 14
  },
  splat(x, z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.6, 1, slope)
    mix[0] = (1 - rock) * 0.8
    mix[1] = smooth(0.45, 0.6, fbm2(x * 0.03, z * 0.03)) * 0.8 + smooth(1, -2, h)
    mix[2] = rock
    mix[3] = smooth(12, 3, roadDist) * 0.8
    tint.setRGB(1, 1, 1)
  },
  surfaceAt: (x, z) => (fbm2(x * 0.03, z * 0.03) > 0.55 ? 'mud' : 'grass'),
  async build(k) {
    const { circuit: c, world: w, d, root } = k
    gantry(k, 'Hollow Manor', '#8a7ad0')
    stands(k, 10, 40, 1, [0x3a3448, 0x5a4a6a, 0x8a7ad0, 0x2a2e38, 0xc8c0b0], 0x8a7ad0, 'Hollow Manor')
    arrows(k, 0xb0a0ff)
    mountainRing(root, 0, -80, { inner: 900, outer: 2600, height: 300, rock: 0x22262e, seed: 41 })

    const stone = new Mesher(), dark = new Mesher(), wood = new Mesher(), slate = new Mesher()
    const winLit: THREE.Matrix4[] = [], winCols: THREE.Color[] = []
    const roadThrough = (x: number, y0: number, y1: number, z: number) => {
      // is the road passing through this bit of wall?
      for (let i = 0; i < c.count; i += 2) {
        const p = c.samples[i]!
        if (Math.abs(p.x - x) < 3 && Math.abs(p.z - z) < c.widths[i]! / 2 + 2.5 && p.y + 9 > y0 && p.y - 1 < y1) return true
      }
      return false
    }
    const wallRun = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number, windows: boolean, ox = 0, oz = 0) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 4), yaw = Math.atan2(bz - az, bx - ax)
      for (let q = 0; q < n; q++) {
        const u = (q + 0.5) / n, x = ax + (bx - ax) * u, z = az + (bz - az) * u
        for (let y = y0; y < y1; y += 5) {
          const top = Math.min(y + 5, y1)
          if (roadThrough(x, y, top, z)) continue
          stone.box(len / n + 0.05, top - y, 1.4, x, (y + top) / 2, z, (q + y) % 3 ? 0x6a6660 : 0x5e5a56, -yaw)
          if (windows && q % 2 === 1 && top - y > 4 && y > y0) {
            winLit.push(new THREE.Matrix4().compose(new THREE.Vector3(x + ox * 0.75, y + 2.6, z + oz * 0.75), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -yaw, 0)), new THREE.Vector3(1.6, 2.8, 1)))
            winCols.push(new THREE.Color(d.rand() < 0.4 ? 0x0a0a0c : d.rand() < 0.7 ? 0xffb05a : 0xffd890).multiplyScalar(d.rand() < 0.4 ? 0.2 : 2.2))
          }
        }
      }
    }
    // ── the main block's outer walls, with the road's doors left open
    const { x0, x1, z0, z1 } = HOUSE
    const base = 2
    wallRun(x0, z1, x1, z1, base, HOUSE.wall, true, 0, 1)
    wallRun(x0, z0, x1, z0, base, HOUSE.wall, true, 0, -1)
    wallRun(x0, z0, x0, z1, base, HOUSE.wall, true, -1, 0)
    wallRun(x1, z0, x1, z1, base, HOUSE.wall, true, 1, 0)
    // the plinth and the steps up to it
    stone.box(x1 - x0 + 4, 4, z1 - z0 + 4, 0, 0.5, (z0 + z1) / 2, 0x4a4844)
    // gabled roof, towers at the corners, chimneys
    const roofGeo = new THREE.CylinderGeometry(1, 1, 1, 3, 1)
    slate.add(roofGeo, trs(0, HOUSE.wall + 7, (z0 + z1) / 2, 0, new THREE.Vector3(14, x1 - x0 + 2, 32), 0, Math.PI / 2), 0x2a2c34)
    for (const [tx, tz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) {
      stone.add(new THREE.CylinderGeometry(6, 6.5, HOUSE.wall + 10, 14), trs(tx!, (HOUSE.wall + 10) / 2, tz!), 0x5e5a56)
      slate.add(new THREE.ConeGeometry(7.4, 16, 14), trs(tx!, HOUSE.wall + 18, tz!), 0x262830)
      w.addPost(tx!, tz!, 6.6)
    }
    for (const cx of [-30, 0, 30]) stone.box(3, 12, 3, cx, HOUSE.wall + 12, (z0 + z1) / 2 + 8, 0x4e4a46)
    // the east wing: lower, with a flat terrace roof the road runs across
    wallRun(WING.x0, WING.z1, WING.x1, WING.z1, base, WING.top - 0.6, true, 0, 1)
    wallRun(WING.x0, WING.z0, WING.x1, WING.z0, base, WING.top - 0.6, true, 0, -1)
    wallRun(WING.x1, WING.z0, WING.x1, WING.z1, base, WING.top - 0.6, false)
    stone.box(WING.x1 - WING.x0, 1, WING.z1 - WING.z0, (WING.x0 + WING.x1) / 2, WING.top - 0.5, (WING.z0 + WING.z1) / 2, 0x4a4844)
    for (let x = WING.x0 + 2; x < WING.x1; x += 2.4) for (const z of [WING.z0 + 0.6, WING.z1 - 0.6]) stone.post(0.25, 0.3, 1.2, x, WING.top, z, 0x7a7670, 6)
    // solid walls for the outside of the house (the road's doors stay open)
    for (const [ax, az, bx, bz, top] of [[x0, z1, x1, z1, 1e6], [x0, z0, x1, z0, 1e6], [WING.x0, WING.z1, WING.x1, WING.z1, WING.top - 1.5], [WING.x0, WING.z0, WING.x1, WING.z0, WING.top - 1.5]] as const) {
      w.addBox((ax + bx) / 2, (az + bz) / 2, (bx - ax) / 2, 1, 0, top)
    }
    w.addBox(x0, (z0 + z1) / 2 - 22, 1, 8, 0, 30)
    w.addBox(x0, (z0 + z1) / 2 + 22, 1, 8, 0, 30)

    // ── the great hall: panelled walls each side of the ramp, a ceiling, chandeliers
    const chand: THREE.Vector3[] = [], sconces: THREE.Vector3[] = []
    for (let i = 0; i < c.count; i += 2) {
      const p = c.samples[i]!
      if (!(p.x > x0 - 1 && p.x < x1 + 1 && Math.abs(p.z - HALL_Z) < 20)) continue
      const t = c.tangents[i]!, r = c.rights[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
      for (const s of [-1, 1]) {
        const wx = p.x + r.x * s * (half + 2.2), wz = p.z + r.z * s * (half + 2.2)
        wood.box(0.8, p.y + 10 - base, 4.2, wx, (p.y + 10 + base) / 2, wz, 0x7a5236, yaw)
        dark.box(0.3, 1, 4.2, wx - r.x * s * 0.5, p.y + 3.2, wz - r.z * s * 0.5, 0x6a4a1a, yaw)
        w.addBox(wx, wz, 0.5, 2.2, yaw)
      }
      dark.box(c.widths[i]! + 6, 0.6, 4.2, p.x, p.y + 10.3, p.z, 0x24160e, yaw)
      // the floor under the ramp
      wood.box(c.widths[i]! + 5, Math.max(0.5, p.y - base), 4.2, p.x, (p.y + base) / 2 - 0.3, p.z, 0x2a1a10, yaw)
      if (i % 16 === 0) chand.push(new THREE.Vector3(p.x, p.y + 7.6, p.z))
      if (i % 8 === 4) for (const s of [-1, 1]) sconces.push(new THREE.Vector3(p.x + r.x * s * (half + 1.6), p.y + 4.2, p.z + r.z * s * (half + 1.6)))
    }
    place(k, stone, surface('stone', { rough: 0.85 }))
    place(k, slate, surface('stone', { rough: 0.6 }))
    place(k, wood, surface('wood'))
    place(k, dark, surface('wood', { rough: 0.5 }))
    // portraits down both walls
    const portraits: THREE.Mesh[] = []
    for (let q = 0; q < 3; q++) {
      const tex = portraitTexture(q)
      const mats: THREE.Matrix4[] = []
      for (let i = q * 6; i < c.count; i += 18) {
        const p = c.samples[i]!
        if (!(p.x > x0 + 4 && p.x < x1 - 4 && Math.abs(p.z - HALL_Z) < 20)) continue
        const t = c.tangents[i]!, r = c.rights[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
        for (const s of [-1, 1]) mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + r.x * s * (half + 1.7), p.y + 5.2, p.z + r.z * s * (half + 1.7)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + (s > 0 ? -Math.PI / 2 : Math.PI / 2), 0)), new THREE.Vector3(2.4, 3, 1)))
      }
      if (mats.length) portraits.push(d.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), mats, false))
    }
    // chandeliers: brass rings with candle flames
    const chandG = new Mesher()
    chandG.add(new THREE.TorusGeometry(2.4, 0.12, 6, 24), trs(0, 0, 0, 0, 1, Math.PI / 2), 0x8a6a2a).post(0.05, 0.05, 2.8, 0, 0, 0, 0x2a2a2a, 4)
    const chandMesh = d.instanced(chandG.build(), surface('metal', { metal: 0.9, rough: 0.3 }), chand.map((v) => trs(v.x, v.y, v.z)), false)
    const flames: THREE.Matrix4[] = []
    for (const v of chand) for (let q = 0; q < 10; q++) flames.push(trs(v.x + Math.cos(q * 0.628) * 2.4, v.y + 0.4, v.z + Math.sin(q * 0.628) * 2.4, 0, new THREE.Vector3(0.12, 0.3, 0.12)))
    const flameMat = glow(4, 2.2, 0.8)
    d.instanced(new THREE.SphereGeometry(1, 6, 4), flameMat, flames, false)
    for (const v of chand) glowStreak(k, v.x, v.y - 7.4, v.z, 0, new THREE.Color(1, 0.6, 0.3).multiplyScalar(0.35), 16, 16)
    void chandMesh
    // candle sconces down the walls, each throwing a warm wash on the panelling
    d.instanced(new THREE.SphereGeometry(1, 6, 4), flameMat, sconces.map((v) => trs(v.x, v.y, v.z, 0, new THREE.Vector3(0.14, 0.32, 0.14))), false)
    const wash = new THREE.MeshBasicMaterial({ map: softDot(), color: new THREE.Color(0.9, 0.5, 0.22), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
    for (const v of sconces) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 7), wash)
      m.position.copy(v)
      m.lookAt(v.x, v.y, HALL_Z)
      m.position.z += Math.sign(HALL_Z - v.z) * 0.3
      root.add(m)
    }

    // lit windows all over the house
    d.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, side: THREE.DoubleSide }), winLit, false, winCols)

    // ── the grounds: graveyard, crypt, hedges, iron fence, dead trees, pumpkins
    const graves: THREE.Matrix4[] = [], stoneCols: THREE.Color[] = []
    for (let q = 0; q < 160; q++) {
      const x = 140 + d.rand() * 110, z = -260 + d.rand() * 150
      if (d.roadGap(x, z) < 6 || w.blocked(x, z, 1)) continue
      const y = w.terrainAt(x, z), tall = 1 + d.rand() * 1.4
      graves.push(trs(x, y + tall / 2 - 0.2, z, (d.rand() - 0.5) * 0.4 + 1.57, new THREE.Vector3(0.9, tall, 0.25), (d.rand() - 0.5) * 0.25))
      stoneCols.push(new THREE.Color(0x6a6a66).multiplyScalar(0.7 + d.rand() * 0.5))
      w.addPost(x, z, 0.5)
    }
    d.instanced(lumpy(new THREE.BoxGeometry(1, 1, 1, 2, 3, 1), 0.04, 3, 2), surface('stone'), graves, true, stoneCols)
    const crypt = new Mesher()
    crypt.box(14, 8, 10, 236, w.terrainAt(236, -240) + 4, -240, 0x5a5652).add(new THREE.CylinderGeometry(1, 1, 1, 3), trs(236, w.terrainAt(236, -240) + 10, -240, 0, new THREE.Vector3(6, 14, 6), 0, Math.PI / 2), 0x3a3a40)
    for (const s of [-1, 1]) crypt.post(0.6, 0.7, 7, 236 + s * 4, w.terrainAt(236, -240), -234.6, 0x7a7670, 10)
    place(k, crypt, surface('stone'))
    w.addBox(236, -240, 7, 5)
    // hedges down the lane
    const hedge = new Mesher()
    for (let i = 0; i < c.count; i += 3) {
      const p = c.samples[i]!
      if (p.x < 150 || p.z < -105 || p.z > 40 || c.raised[i]) continue
      const r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
      for (const s of [-1, 1]) {
        const x = p.x + r.x * s * (half + 4), z = p.z + r.z * s * (half + 4)
        if (d.roadGap(x, z) < 3) continue
        hedge.box(1.8, 2.6, 6.4, x, w.terrainAt(x, z) + 1.2, z, [0x2a3a22, 0x24341e][i % 2]!, Math.atan2(-t.x, -t.z))
        w.addPost(x, z, 1)
      }
    }
    place(k, hedge, surface('rock', { rough: 1 }))
    // iron fence and gate posts round the drive
    const fence = new Mesher()
    for (let i = 0; i < c.count; i += 2) {
      const p = c.samples[i]!
      if (c.raised[i] || p.z < -140 || p.x > 120 || p.x < -180) continue
      const r = c.rights[i]!
      for (const s of [-1, 1]) {
        const x = p.x + r.x * s * (c.widths[i]! / 2 + 6), z = p.z + r.z * s * (c.widths[i]! / 2 + 6)
        if (d.roadGap(x, z) < 4) continue
        fence.post(0.05, 0.05, 2.4, x, w.terrainAt(x, z), z, 0x18181c, 4)
        fence.add(new THREE.ConeGeometry(0.12, 0.4, 4), trs(x, w.terrainAt(x, z) + 2.5, z), 0x18181c)
      }
    }
    place(k, fence, surface('metal', { rough: 0.6 }), false)
    forest(k, 'dead', d.spots(110, 6, 110, { clear: 7, test: (x, z) => !inHouse(x, z, 10) }), { scale: [0.9, 1.5] })
    forest(k, 'pine', d.spots(120, 60, 300, { clear: 30, test: (x, z) => !inHouse(x, z, 30) }), { scale: [1, 1.5], solid: 0, tints: [0x3a4438, 0x2e3a2e] })
    grass(k, { density: 2.2, reach: 20, height: [0.5, 1.1], colors: [0x4a5238, 0x3e4630, 0x56583e], test: (x, z, y) => y > 0 && !inHouse(x, z, 6) })
    d.prop('dead_tree_trunk_02', d.spots(18, 8, 50, { clear: 8, test: (x, z) => !inHouse(x, z, 10) }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.4 + d.rand())), 1)
    d.prop('rock_moss_set_01', d.spots(24, 6, 40, { clear: 6, test: (x, z) => !inHouse(x, z, 10) }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.5 + d.rand())), 1)
    crates(d, d.spots(12, 2, 7, { from: 0.02, to: 0.2, clear: 1.6 }), 0x6a5a48)
    // pumpkins glowing by the drive
    const pumpkins: THREE.Matrix4[] = []
    for (const s of d.spots(40, 2.5, 8, { clear: 2, test: (x, z) => !inHouse(x, z, 4) })) pumpkins.push(trs(s.x, s.y + 0.35, s.z, d.rand() * 6, new THREE.Vector3(0.7, 0.55, 0.7)))
    d.instanced(lumpy(new THREE.SphereGeometry(1, 12, 8), 0.08, 3, 5), glow(2.6, 0.9, 0.12), pumpkins, false)
    mist(k, d.spots(50, 4, 90, { clear: 2 }).map((s) => s.setY(s.y + 1.4)), [18, 34], 0x9aa4b8, 0.2)

    // the moon
    const moon = new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.6, 1.5), fog: false, toneMapped: false }))
    moon.position.set(-900, 700, -1600)
    root.add(moon)

    // ── the storm and the ghosts
    const flash = new THREE.DirectionalLight(0xc8d4ff, 0)
    flash.position.set(-200, 400, -300)
    root.add(flash)
    const rain = drift(k, 420, 0xb8c4d8, 2.2, 32, true)
    rain.visible = false
    const ghostTex = canvasTexture(64, 96, (g, W, H) => {
      const gr = g.createRadialGradient(W / 2, H * 0.35, 2, W / 2, H * 0.4, W * 0.6)
      gr.addColorStop(0, 'rgba(230,240,255,0.95)')
      gr.addColorStop(1, 'rgba(230,240,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, W, H)
      g.fillStyle = 'rgba(10,12,20,0.9)'
      g.beginPath(); g.ellipse(W * 0.38, H * 0.32, 4, 6, 0, 0, 6.3); g.ellipse(W * 0.62, H * 0.32, 4, 6, 0, 0, 6.3); g.fill()
    })
    const ghosts = Array.from({ length: 10 }, (_, q) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ghostTex, color: 0xd8e4ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))
      s.scale.set(3, 4.4, 1)
      root.add(s)
      return { s, i: Math.floor((q / 10) * c.count), ph: q * 2.1 }
    })
    let nextBolt = 5, boltT = 0
    k.onFrame((f) => {
      flameMat.color.setRGB(3.6 + Math.sin(f.time * 17) * 0.5, 2 + Math.sin(f.time * 13) * 0.3, 0.8)
      const storm = f.lap >= 2
      rain.visible = storm
      if (storm && f.time > nextBolt) { nextBolt = f.time + 3 + Math.random() * 6; boltT = 0.5 }
      boltT -= f.dt
      flash.intensity = boltT > 0 ? (Math.sin(boltT * 60) > 0 ? 6 : 1) * boltT * 2 : 0
      k.road.wet.value = storm ? 0.9 : 0.4
      const late = f.totalLaps > 1 && f.lap >= f.totalLaps
      for (const g of ghosts) {
        const m = g.s.material as THREE.SpriteMaterial
        m.opacity += ((late ? 0.75 : 0) - m.opacity) * Math.min(1, f.dt)
        if (m.opacity < 0.01) continue
        const i = (g.i + Math.floor(f.time * 3)) % c.count, p = c.samples[i]!, r = c.rights[i]!
        const lat = Math.sin(f.time * 0.6 + g.ph) * c.widths[i]! * 0.4
        g.s.position.set(p.x + r.x * lat, p.y + 2.4 + Math.sin(f.time * 2 + g.ph) * 0.6, p.z + r.z * lat)
      }
    })
    void portraits
  },
}
