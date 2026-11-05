import * as THREE from 'three'
import type { Track, ZoneName } from '../Track'
import type { BuildCtx } from './types'
import { instanced, lumpy, rightAt, trs, zoneIndices, canvasTexture } from './kit'

/**
 * The big readable things: neon gates that pulse past at a steady beat (the
 * clearest way to show speed), and one enormous landmark per area, sized to
 * be seen from far away.
 */

/** Glowing arches over the road every `every` metres along the zones. */
export function buildGates(track: Track, group: THREE.Group, zones: ZoneName[], every: number, skip: (i: number) => boolean = () => false, radius = 14.5): void {
  const ids = zoneIndices(track, ...zones)
  const mats: THREE.Matrix4[] = [], colors: THREE.Color[] = []
  let acc = every * 0.5
  for (let k = 1; k < ids.length; k++) {
    const i = ids[k]!
    if (ids[k - 1] !== i - 1) { acc = every * 0.5; continue }
    acc += track.samples[i]!.distanceTo(track.samples[i - 1]!)
    if (acc < every || track.isGap(i) || skip(i)) continue
    acc = 0
    const p = track.samples[i]!, tg = track.tangents[i]!
    mats.push(trs(p.x, p.y - 0.3, p.z, Math.atan2(tg.x, tg.z)))
    colors.push(track.accents[i]!.clone().multiplyScalar(2.2))
  }
  if (!mats.length) return
  const arc = new THREE.TorusGeometry(radius, 0.26, 8, 40, Math.PI)
  group.add(instanced(arc, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), mats, colors, false))
}

const glow = (r: number, g: number, b: number, fog = false): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false, fog })

/** Sea: a colossal beacon tower with slowly stacked light rings. */
function coastBeacon(g: THREE.Group): void {
  const x = 760, z = 130
  const body = new THREE.MeshStandardMaterial({ color: 0xe9e3da, roughness: 0.5, metalness: 0.2 })
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(9, 26, 260, 28, 1), body)
  tower.position.set(x, 130, z)
  g.add(tower)
  for (let k = 0; k < 5; k++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(30 + k * 7, 1.1, 8, 64), glow(2.4, 1.1, 0.6))
    ring.rotation.x = Math.PI / 2
    ring.position.set(x, 70 + k * 46, z)
    g.add(ring)
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(13, 20, 14), glow(3, 2.2, 1.2))
  top.position.set(x, 268, z)
  g.add(top)
}

/** Canyon: a natural rock arch big enough to frame the sky. */
function canyonArch(g: THREE.Group): void {
  const m = new THREE.MeshStandardMaterial({ color: 0xb4623a, roughness: 1, flatShading: true })
  const a = new THREE.Mesh(lumpy(new THREE.TorusGeometry(95, 20, 12, 40, Math.PI), 7, 0.03, 8), m)
  a.position.set(-520, 0, -130)
  a.rotation.y = 0.9
  g.add(a)
}

/** Desert: three colossal leaning monoliths with gold-lit edges. */
function desertMonoliths(g: THREE.Group, h: (x: number, z: number) => number): void {
  const stone = new THREE.MeshStandardMaterial({ color: 0x2a211d, roughness: 0.6, metalness: 0.3 })
  const edge = glow(3, 1.7, 0.4)
  for (const [x, z, s, lean] of [[-870, -1060, 1, 0.1], [-905, -1000, 0.72, -0.14], [-840, -1125, 0.6, 0.2]] as const) {
    const m = new THREE.Group()
    const slab = new THREE.Mesh(new THREE.BoxGeometry(46 * s, 300 * s, 16 * s), stone)
    slab.position.y = 130 * s
    const seam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 300 * s, 16.4 * s), edge)
    seam.position.y = 130 * s
    m.add(slab, seam)
    m.position.set(x, h(x, z) - 6, z)
    m.rotation.set(0, 1.1, lean)
    g.add(m)
  }
}

/** Alpine pass: a cluster of giant glowing ice crystals. */
function snowCrystals(g: THREE.Group, h: (x: number, z: number) => number): void {
  const ice = new THREE.MeshStandardMaterial({ color: 0xa8e6ff, emissive: 0x2a8fe0, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.1, flatShading: true })
  const geo = new THREE.OctahedronGeometry(1, 0)
  for (const [x, z, s, r] of [[860, -1000, 130, 0.08], [905, -965, 90, -0.3], [810, -1040, 80, 0.32], [930, -1030, 60, 0.5]] as const) {
    const m = new THREE.Mesh(geo, ice)
    m.scale.set(s * 0.26, s, s * 0.26)
    m.position.set(x, h(x, z) + s * 0.55, z)
    m.rotation.set(0, s, r)
    g.add(m)
  }
}

/** Sky: a ringed planet filling part of the horizon. */
function skyPlanet(g: THREE.Group): void {
  const tex = canvasTexture(512, 256, (c, w, h) => {
    for (let y = 0; y < h; y++) {
      const v = Math.sin(y * 0.09) * 0.5 + Math.sin(y * 0.031 + 2) * 0.5
      c.fillStyle = `rgb(${232 + v * 22},${150 + v * 42},${118 + v * 50})`
      c.fillRect(0, y, w, 1)
    }
  })
  const planet = new THREE.Mesh(new THREE.SphereGeometry(330, 40, 28), new THREE.MeshBasicMaterial({ map: tex, fog: false }))
  planet.position.set(1950, 420, 300)
  planet.rotation.z = 0.35
  const ring = new THREE.Mesh(new THREE.RingGeometry(420, 590, 96), new THREE.MeshBasicMaterial({ color: 0xfff0d8, transparent: true, opacity: 0.55, side: THREE.DoubleSide, fog: false }))
  ring.position.copy(planet.position)
  ring.rotation.set(1.25, 0.25, 0)
  g.add(planet, ring)
}

/** Rainforest: one impossibly large tree in the middle of the loop. */
function jungleTree(g0: THREE.Group, h: (x: number, z: number) => number): THREE.Object3D {
  const g = new THREE.Group()
  g0.add(g)
  const x = 318, z = -560, y = h(x, z)
  const bark = new THREE.MeshStandardMaterial({ color: 0x4b3423, roughness: 1, flatShading: true })
  const leaf = new THREE.MeshStandardMaterial({ color: 0x1f8a3f, emissive: 0x0b3a18, roughness: 0.9, flatShading: true })
  const trunk = new THREE.Mesh(lumpy(new THREE.CylinderGeometry(15, 34, 230, 18, 10), 5, 0.04, 2), bark)
  trunk.position.set(x, y + 112, z)
  g.add(trunk)
  for (const [dx, dy, dz, s] of [[0, 250, 0, 92], [-74, 214, 30, 66], [70, 220, -28, 70], [20, 204, 76, 58], [-20, 212, -78, 60]] as const) {
    const m = new THREE.Mesh(lumpy(new THREE.IcosahedronGeometry(1, 3), 0.18, 1.5, s), leaf)
    m.scale.set(s, s * 0.62, s)
    m.position.set(x + dx, y + dy, z + dz)
    g.add(m)
  }
  return g
}

/** Neon City: a holographic globe turning over the skyline. */
function cityGlobe(g: THREE.Group): THREE.Object3D {
  const globe = new THREE.Group()
  const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(82, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.7, 2.3), wireframe: true, toneMapped: false, fog: false, transparent: true, opacity: 0.7 }))
  const ring = new THREE.Mesh(new THREE.TorusGeometry(118, 1.4, 8, 96), glow(2.6, 0.5, 2))
  ring.rotation.x = 1.3
  globe.add(wire, ring)
  globe.position.set(60, 215, -470)
  g.add(globe)
  return globe
}

/** Land landmarks; returns the ones that turn. */
export function buildLandmarks(ctx: BuildCtx, groups: Record<string, THREE.Group>): { globe: THREE.Object3D; tree: THREE.Object3D } {
  const h = (x: number, z: number) => ctx.terrain.heightAt(x, z)
  coastBeacon(groups['coast']!)
  canyonArch(groups['canyon']!)
  desertMonoliths(groups['desert']!, h)
  snowCrystals(groups['snow']!, h)
  skyPlanet(groups['sky']!)
  return { tree: jungleTree(groups['jungle']!, h), globe: cityGlobe(groups['city']!) }
}

/** Moon: a broken ring station hanging over the far horizon. */
export function spaceLandmark(group: THREE.Group): void {
  const steel = new THREE.MeshStandardMaterial({ color: 0x4a5266, metalness: 0.7, roughness: 0.4, fog: false })
  const ring = new THREE.Mesh(new THREE.TorusGeometry(620, 34, 12, 96, Math.PI * 1.55), steel)
  ring.position.set(-1400, 420, 40)
  ring.rotation.set(0.5, 1.2, 0.4)
  const lit = new THREE.Mesh(new THREE.TorusGeometry(620, 37, 4, 96, Math.PI * 1.55), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 2.6), wireframe: true, toneMapped: false, fog: false }))
  lit.position.copy(ring.position)
  lit.rotation.copy(ring.rotation)
  group.add(ring, lit)
}

/** Sea floor: the rib cage of something enormous, arching beside the tunnel. */
export function seaRibs(track: Track, group: THREE.Group, at: number): void {
  const p = track.samples[at]!, r = rightAt(track, at), tg = track.tangents[at]!
  const bone = new THREE.MeshStandardMaterial({ color: 0xd6dcc8, roughness: 0.8, emissive: 0x1b4a4a })
  const rib = new THREE.TorusGeometry(46, 2, 8, 30, Math.PI * 0.9)
  const mats: THREE.Matrix4[] = []
  for (let k = -7; k <= 7; k++) {
    const q = p.clone().addScaledVector(r, 92).addScaledVector(tg, k * 15)
    mats.push(trs(q.x, p.y - 8, q.z, Math.atan2(tg.x, tg.z), 1 - Math.abs(k) * 0.05))
  }
  group.add(instanced(rib, bone, mats, undefined, false))
}
