import * as THREE from 'three'
import { canvasTexture, fbm2, lumpy, smooth, softDot, trs } from '../../game/biomes/kit'
import { Mesher, place, surface } from '../art/arch'
import { forest } from '../art/foliage'
import { mountainRing } from '../art/terrain'
import type { BuildKit, TrackDef } from '../types'
import { arrows, crates, drift, gantry, glow, glowStreak, mist, stands } from './parts'

/** The two wrecks the road runs along: stern and bow ends, as x ranges at a rough z. */
const SHIPS = [
  { x0: 36, x1: 198, z: -220, deck: 8, stern: 198 },
  { x0: -116, x1: -34, z: -196, deck: 6, stern: -34 },
]
const ISLET = { x: -196, z: -56, r: 58 }
const GHOST = 0x6affc8

/** Tattered sailcloth, holed and frayed at the bottom. */
function sailTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g, W, H) => {
    g.clearRect(0, 0, W, H)
    g.fillStyle = 'rgba(210,235,225,0.85)'
    g.beginPath()
    g.moveTo(0, 0); g.lineTo(W, 0)
    for (let x = W; x >= 0; x -= 8) g.lineTo(x, H * (0.7 + Math.random() * 0.3))
    g.closePath()
    g.fill()
    g.globalCompositeOperation = 'destination-out'
    for (let q = 0; q < 14; q++) { g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H * 0.8, 3 + Math.random() * 9, 3 + Math.random() * 7, 0, 0, 6.3); g.fill() }
    g.globalCompositeOperation = 'source-over'
  })
}

/**
 * Ghost Galleon Bay: off the harbour quay onto the piers, up a gangway into
 * the stern castle of a great wreck and along its deck under the masts, then a
 * leap from the bow to the next ship. Down through the sea cave on the islet
 * and back over the low causeway. On the second lap the tide comes in over
 * the causeway; on the last a phantom galleon sails the bay, firing.
 */
export const galleon: TrackDef = {
  id: 'galleon',
  name: 'Ghost Galleon Bay',
  ambience: 'coast',
  width: 15,
  bank: 2.2,
  shoulder: 9,
  accent: 0x4ad0b0,
  sea: 0,
  water: { deep: 0x03141a, shallow: 0x0e3a3a, foam: 0x7ad8c0, waves: 1.1 },
  rails: 'wood',
  piers: 'none',
  road: { lines: 'plain', grime: 0x2a3a34, tone: 0.75, sheen: 0.5, kerb: false },
  terrain: { layers: ['coast_sand_01', 'rock_pitted_mossy', 'brown_mud_leaves_01', 'grass'], tile: [16, 18, 10, 22], tints: [0x8a9a90, 0x7a8a84, 0x6a7468, 0x5a6a50] },
  look: {
    tod: 'night', generatedSky: true, top: [0.01, 0.03, 0.04], horizon: [0.06, 0.18, 0.18], mix: 0.9, stars: 0.8,
    fog: [0.06, 0.16, 0.15], fogDensity: 0.0024, fogBase: 2, fogFall: 0.035, sunGlow: 0.3,
    exposure: 1.5, sun: 1.2, hemi: 1.25, bloom: 0.58, wet: 0.6, headlights: 1, env: 0.7,
    grade: [0.95, 1.12, 0.004, 0.012, 0.012, 0.96, 1.04, 1.02, 0.4],
  },
  points: [
    [0, 2.5, 0],
    [110, 2.5, -4, { pad: 0 }],
    [178, 2.6, -28],
    [218, 3, -80, { raised: true, deck: 'wood', rail: 'LR' }],
    [232, 4.5, -150, { raised: true, deck: 'wood', rail: 'LR' }],
    [206, 8, -208, { raised: true, deck: 'wood', rail: 'LR' }],
    [150, 8, -222, { raised: true, deck: 'wood', rail: '' }],
    [92, 8, -224, { raised: true, deck: 'wood', rail: '', pad: 0 }],
    // the bow sweeps up into a kicker; the second wreck sits lower in the water
    [40, 10, -220, { raised: true, deck: 'wood', rail: '' }],
    [-4, 13, -210, { gap: true }],
    [-44, 5, -198, { raised: true, deck: 'wood', rail: '' }],
    [-104, 6, -178, { raised: true, deck: 'wood', rail: '' }],
    [-150, 4, -142, { raised: true, deck: 'wood', rail: 'LR' }],
    [-186, 4, -92],
    [-196, 3.6, -26],
    [-160, 1.6, 34],
    [-90, 1.8, 46],
    [-42, 2.5, 16],
  ],
  ground(x, z) {
    const n = fbm2(x * 0.01, z * 0.01)
    // the harbour shore and the town hill behind it
    const shore = smooth(-34, -8, z) * smooth(-130, -70, x) * smooth(330, 260, x)
    const town = smooth(30, 140, z) * 24 * shore
    const islet = Math.max(0, 1 - Math.hypot((x - ISLET.x) / ISLET.r, (z - ISLET.z) / (ISLET.r * 1.3)))
    const far = smooth(500, 800, Math.hypot(x, z + 100)) * (30 + n * 80)
    return -14 + shore * 16 + town + Math.pow(islet, 0.6) * 30 + far + n * 3
  },
  splat(_x, _z, h, slope, roadDist, mix, tint) {
    const rock = smooth(0.5, 0.9, slope)
    const beach = smooth(5, 1.5, h)
    mix[0] = beach
    mix[1] = rock
    mix[2] = (1 - beach) * (1 - rock) * 0.6
    mix[3] = (1 - beach) * (1 - rock) * smooth(4, 10, h)
    tint.setRGB(1, 1, 1)
    void roadDist
  },
  surfaceAt: (_x, _z) => 'sand',
  async build(k) {
    const { circuit: c, world: w, d, root, water } = k
    gantry(k, 'Ghost Galleon Bay', '#4ad0b0')
    stands(k, 8, 40, 1, [0x2a4a48, 0x4ad0b0, 0xc8c0b0, 0x2a2e38, 0x6a5a48], 0x4ad0b0, 'Ghost Galleon Bay')
    arrows(k, GHOST)
    mountainRing(root, 0, -100, { inner: 1000, outer: 2800, height: 260, rock: 0x1a2426, seed: 51 })

    const plank = new Mesher(), hull = new Mesher(), iron = new Mesher(), sails: THREE.Matrix4[] = []
    const lanterns: THREE.Matrix4[] = []
    // ── piers: pilings and cross-bracing under every raised wooden stretch off the ships
    const onShip = (x: number, z: number) => SHIPS.some((s) => x > s.x0 - 4 && x < s.x1 + 4 && Math.abs(z - s.z) < 26)
    for (let i = 0; i < c.count; i += 3) {
      if (!c.raised[i] || c.gap[i]) continue
      const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
      if (onShip(p.x, p.z)) continue
      plank.box(c.widths[i]! + 1.6, 0.5, 6.4, p.x, p.y - 0.5, p.z, 0x4a3a2a, yaw)
      if (i % 6 === 0) for (const s of [-1, 1]) {
        const x = p.x + r.x * s * (half + 0.4), z = p.z + r.z * s * (half + 0.4)
        plank.post(0.32, 0.36, p.y + 6, x, -6, z, 0x3a2e22, 7)
        w.addPost(x, z, 0.5, p.y - 1.5)
        if (i % 12 === 0) lanterns.push(trs(x, p.y + 2.6, z, 0, 0.3))
      }
      if (i % 12 === 0) plank.bar(new THREE.Vector3(p.x + r.x * half, -1, p.z + r.z * half), new THREE.Vector3(p.x - r.x * half, p.y - 1, p.z - r.z * half), 0.14, 0x3a2e22, 5)
    }

    // ── the wrecks: hull sides under the deck road, masts, yards and rags of sail
    for (const s of SHIPS) {
      const len = s.x1 - s.x0
      for (let i = 0; i < c.count; i += 2) {
        const p = c.samples[i]!
        if (c.gap[i] || p.x < s.x0 || p.x > s.x1 || Math.abs(p.z - s.z) > 26) continue
        const u = (p.x - s.x0) / len // 0 at the bow, 1 at the stern
        const r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
        const beam = Math.max(half + 1.4, (half + 2.6) * (0.62 + 0.38 * Math.sin(Math.min(1, u * 1.6 + 0.1) * Math.PI / 2)))
        plank.box(beam * 2, 0.5, 4.4, p.x, p.y - 0.45, p.z, 0x3a2c20, yaw)
        for (const sd of [-1, 1]) {
          const x = p.x + r.x * sd * beam, z = p.z + r.z * sd * beam
          // the hull: planked sides that tuck in towards the keel
          hull.box(0.6, p.y + 6, 4.5, x - r.x * sd * 1.2, (p.y + 1.4 - 6) / 2 - 0.4, z - r.z * sd * 1.2, (i / 2) % 2 ? 0x3a2a1e : 0x32261a, yaw, sd * 0.18)
          hull.box(0.5, 1.6, 4.5, x, p.y + 0.6, z, 0x4a3828, yaw)
          w.addBox(x, z, 0.5, 2.3, yaw, p.y + 1.6)
        }
        if (i % 8 === 0) for (const sd of [-1, 1]) lanterns.push(trs(p.x + r.x * sd * beam, p.y + 2, p.z + r.z * sd * beam, 0, 0.26))
      }
      // three masts, set against the rails so the deck stays clear
      for (const [mu, side, tall] of [[0.2, 1, 30], [0.5, -1, 40], [0.8, 1, 34]] as const) {
        const x = s.x0 + len * mu
        let i = c.track(x, s.z, Math.floor(c.count * 0.4), Math.floor(c.count / 2))
        i = Math.max(0, i)
        const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2
        const mx = p.x + r.x * side * (half + 0.4), mz = p.z + r.z * side * (half + 0.4)
        iron.post(0.55, 0.42, tall, mx, p.y - 0.5, mz, 0x2e241a, 10)
        w.addPost(mx, mz, 0.7)
        // yards over the road, with torn sails hanging below them
        for (const yh of [tall * 0.5, tall * 0.8]) {
          const yaw = Math.atan2(-t.x, -t.z)
          iron.box(c.widths[i]! + 10, 0.4, 0.4, p.x, p.y + yh, p.z, 0x2e241a, yaw)
          sails.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y + yh - 4.6, p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(c.widths[i]! + 6, 8.6, 1)))
        }
        lanterns.push(trs(mx, p.y + tall + 0.6, mz, 0, 0.4))
      }
      // the stern castle: the road drives in under its gallery
      {
        const i = c.track(s.stern - 6, s.z, Math.floor(c.count * 0.4), Math.floor(c.count / 2))
        const p = c.samples[i]!, r = c.rights[i]!, t = c.tangents[i]!, half = c.widths[i]! / 2, yaw = Math.atan2(-t.x, -t.z)
        for (const sd of [-1, 1]) {
          const x = p.x + r.x * sd * (half + 1.6), z = p.z + r.z * sd * (half + 1.6)
          hull.box(2.4, 10, 14, x, p.y + 4.6, z, 0x3a2a1e, yaw)
          w.addBox(x, z, 1.2, 7, yaw)
        }
        hull.box(c.widths[i]! + 6, 1.4, 14, p.x, p.y + 9.4, p.z, 0x2e2218, yaw)
        hull.box(c.widths[i]! + 7, 5, 6, p.x, p.y + 12.6, p.z, 0x3a2a1e, yaw)
        for (let q = -2; q <= 2; q++) lanterns.push(trs(p.x + r.x * q * 3 + t.x * 3.2, p.y + 12.6, p.z + r.z * q * 3 + t.z * 3.2, 0, new THREE.Vector3(0.9, 1.4, 0.2)))
      }
    }
    place(k, plank, surface('wood'))
    place(k, hull, surface('wood', { rough: 0.9 }))
    place(k, iron, surface('wood', { rough: 0.7 }))
    const sailMat = new THREE.MeshStandardMaterial({ map: sailTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, color: 0xb8d8cc, emissive: new THREE.Color(0x0a3a2a), roughness: 0.9, opacity: 0.5 })
    const sailMesh = d.instanced(new THREE.PlaneGeometry(1, 1, 6, 4), sailMat, sails, false)
    sailMesh.frustumCulled = false
    // the jump lip off the bow
    const lip = new Mesher()
    for (let i = 0; i < c.count; i++) {
      const j = (i + 1) % c.count
      if (!(!c.gap[i] && c.gap[j])) continue
      const p = c.samples[i]!, t = c.tangents[i]!
      lip.box(c.widths[i]! + 1, 2, 1.2, p.x, p.y - 1.2, p.z, 0x5a4430, Math.atan2(-t.x, -t.z))
      lip.box(c.widths[i]! + 1, 0.3, 1.3, p.x, p.y - 0.1, p.z, 0x2a8a6a, Math.atan2(-t.x, -t.z))
    }
    place(k, lip, surface('paint'))

    // ghost lanterns: cold green light
    const lantMat = glow(0.8, 4, 2.6)
    d.instanced(new THREE.SphereGeometry(1, 8, 6), lantMat, lanterns, false)
    for (let q = 0; q < lanterns.length; q += 3) {
      const e = lanterns[q]!.elements
      glowStreak(k, e[12]!, Math.max(0.1, e[13]! - 2.2), e[14]!, 0, new THREE.Color(0.2, 1, 0.7).multiplyScalar(0.16), 10, 10)
    }

    // ── the sea cave: a rock arch over the road on the islet
    const rock = lumpy(new THREE.IcosahedronGeometry(1, 3), 0.25, 1.4, 7)
    const cave = new Mesher()
    for (let i = 0; i < c.count; i += 3) {
      const p = c.samples[i]!
      if (Math.hypot(p.x - ISLET.x, p.z - ISLET.z) > ISLET.r * 0.55) continue
      const r = c.rights[i]!, half = c.widths[i]! / 2
      for (const sd of [-1, 1]) {
        const x = p.x + r.x * sd * (half + 7), z = p.z + r.z * sd * (half + 7)
        cave.add(rock, trs(x, p.y + 4, z, d.rand() * 6, new THREE.Vector3(5.6, 10, 7)), 0x3a403c)
        w.addPost(x, z, 5)
      }
      cave.add(rock, trs(p.x, p.y + 13, p.z, d.rand() * 6, new THREE.Vector3(half + 12, 5, 8)), 0x343a36)
    }
    place(k, cave, surface('rock'))
    // drips of glowing moss in the cave and on the islet
    const moss: THREE.Matrix4[] = []
    for (let q = 0; q < 160; q++) {
      const a = d.rand() * 6.28, rr = d.rand() * ISLET.r * 0.8, x = ISLET.x + Math.cos(a) * rr, z = ISLET.z + Math.sin(a) * rr
      moss.push(trs(x, w.terrainAt(x, z) + 0.2, z, 0, 0.12 + d.rand() * 0.2))
    }
    d.instanced(new THREE.SphereGeometry(1, 5, 4), glow(0.3, 2.4, 1.6), moss, false)

    // ── the harbour: quay wall, warehouses, the town above, wrecks out in the bay
    const quay = new Mesher()
    for (let x = -60; x < 260; x += 6) quay.box(6.2, 6, 3, x, -1, -14 + Math.sin(x * 0.02) * 2, 0x4a4e4a)
    place(k, quay, surface('stone'))
    const town = new Mesher(), roofs = new Mesher(), litWin: THREE.Matrix4[] = []
    for (let q = 0; q < 46; q++) {
      const x = -80 + d.rand() * 360, z = 30 + d.rand() * 120
      if (d.roadGap(x, z) < 12 || w.blocked(x, z, 7)) continue
      const y = w.terrainAt(x, z), wd = 7 + d.rand() * 5, dp = 6 + d.rand() * 4, h = 6 + d.rand() * 7, yaw = (d.rand() - 0.5) * 0.4
      town.box(wd, h, dp, x, y + h / 2, z, [0x5a5248, 0x4e4a44, 0x625a50][q % 3]!, yaw)
      roofs.add(new THREE.CylinderGeometry(1, 1, 1, 3), trs(x, y + h + 2, z, yaw, new THREE.Vector3(4, wd + 0.6, dp / 2 + 0.6), 0, Math.PI / 2), 0x2a2a30)
      for (let wv = 0; wv < 3; wv++) if (d.rand() < 0.45) litWin.push(trs(x + (wv - 1) * wd * 0.3, y + 2.4 + (wv % 2) * 3, z - dp / 2 - 0.05, yaw, new THREE.Vector3(1.2, 1.6, 1)))
      w.addBox(x, z, wd / 2, dp / 2, yaw)
    }
    place(k, town, surface('plaster'))
    place(k, roofs, surface('stone'))
    d.instanced(new THREE.PlaneGeometry(1, 1), glow(3, 1.8, 0.7), litWin, false)
    const tint = new THREE.Color(0.55, 0.8, 0.7)
    d.prop('bk:dutch_ship_large_01', [trs(260, -1.5, -360, 1.2, 1.4, 0.08), trs(-320, -1.5, -250, 2.4, 1.2, -0.12)], 0, tint, 0)
    d.prop('dutch_ship_medium', [trs(120, -2.5, -330, 0.4, 2.2, 0.3), trs(-280, -2, 80, 1.9, 1.8, -0.22)], 0, tint, 0)
    d.prop('bk:coast_rocks_01', d.spots(14, 8, 60, { clear: 10 }).map((s) => trs(s.x, Math.min(s.y, 0.4) - 1, s.z, d.rand() * 6, 0.24)), 0, undefined, 420)
    d.prop('wooden_barrels_01', d.spots(16, 2, 7, { from: 0, to: 0.14, clear: 2 }).map((s) => trs(s.x, s.y, s.z, d.rand() * 6, 1.3)), 0.8)
    d.prop('lateral_sea_marker', [trs(60, 0, -120, 0, 2), trs(-80, 0, -110, 1, 2)])
    crates(d, d.spots(16, 2, 7, { from: 0.02, to: 0.15, clear: 1.6 }), 0x6a5a40)
    forest(k, 'dead', d.spots(30, 10, 60, { clear: 8, test: (_x, _z, y) => y > 4 }), { scale: [0.8, 1.2] })
    mist(k, Array.from({ length: 60 }, () => new THREE.Vector3(-300 + d.rand() * 600, 2 + d.rand() * 3, -380 + d.rand() * 460)), [30, 60], 0x6aa898, 0.14)
    // the moon, low over the water
    const moon = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.6, 1.5), fog: false, toneMapped: false }))
    moon.position.set(600, 380, -1500)
    root.add(moon)

    // ── the phantom galleon and its cannon fire; the tide
    const phantom = new THREE.Group()
    root.add(phantom)
    const ghostHull = new THREE.Mesh(new Mesher().box(10, 7, 40, 0, 1, 0, 0xffffff).box(4, 6, 10, 0, 6, -14, 0xffffff).build(), new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false }))
    phantom.add(ghostHull)
    const ghostSails = new THREE.Mesh(new THREE.PlaneGeometry(22, 18), new THREE.MeshBasicMaterial({ map: sailMat.map, color: GHOST, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }))
    ghostSails.position.y = 18
    ghostSails.rotation.y = Math.PI / 2
    phantom.add(ghostSails)
    const splashes = Array.from({ length: 6 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xc8f0e8, transparent: true, opacity: 0, depthWrite: false }))
      root.add(s)
      return { s, t: 9 }
    })
    let nextShot = 0
    const spray = drift(k, 140, 0xa8d8d0, 1.2, 4)
    const sprayMat = spray.material as THREE.PointsMaterial
    const sea0 = water?.mesh.position.y ?? 0
    k.onFrame((f) => {
      lantMat.color.setRGB(0.6 + Math.sin(f.time * 3) * 0.2, 3.6 + Math.sin(f.time * 2.3) * 0.5, 2.4)
      // the tide: in on lap two, a little higher on the last
      const tide = f.lap >= 2 ? (f.totalLaps > 2 && f.lap >= f.totalLaps ? 1.15 : 0.85) : 0
      if (water) water.mesh.position.y += (sea0 + tide - water.mesh.position.y) * Math.min(1, f.dt * 0.3)
      k.road.wet.value = 0.6 + tide * 0.35
      sprayMat.opacity = 0.2 + tide * 0.4
      const late = f.totalLaps > 1 && f.lap >= f.totalLaps
      const a = f.time * 0.04
      phantom.position.set(-20 + Math.cos(a) * 260, 0, -120 + Math.sin(a) * 160)
      phantom.rotation.y = -a
      const show = late ? 0.4 : 0
      const hm = ghostHull.material as THREE.MeshBasicMaterial, sm = ghostSails.material as THREE.MeshBasicMaterial
      hm.opacity += (show * 0.6 - hm.opacity) * Math.min(1, f.dt)
      sm.opacity += (show - sm.opacity) * Math.min(1, f.dt)
      if (late && f.time > nextShot) {
        nextShot = f.time + 1.2 + Math.random() * 2
        const sp = splashes.find((q) => q.t > 1.4)
        if (sp) {
          const i = Math.floor(Math.random() * c.count), p = c.samples[i]!, r = c.rights[i]!, side = Math.random() < 0.5 ? -1 : 1
          sp.s.position.set(p.x + r.x * side * (c.widths[i]! / 2 + 10 + Math.random() * 20), 2, p.z + r.z * side * (c.widths[i]! / 2 + 10 + Math.random() * 20))
          sp.t = 0
        }
      }
      for (const sp of splashes) {
        sp.t += f.dt
        const m = sp.s.material as THREE.SpriteMaterial
        m.opacity = sp.t < 1.4 ? (1 - sp.t / 1.4) * 0.8 : 0
        sp.s.scale.set(6 + sp.t * 6, 4 + Math.min(1, sp.t * 3) * 14, 1)
        sp.s.position.y = 1 + sp.s.scale.y / 2
      }
    })
  },
}
