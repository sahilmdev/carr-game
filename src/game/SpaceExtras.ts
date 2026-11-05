import * as THREE from 'three'
import type { Track } from './Track'
import { props, at, type PropName } from './biomes/Props'
import { rng, rightAt, canvasTexture, instanced, trs, lumpy } from './biomes/kit'

/**
 * More life on the moon plateau: scanned lunar rocks, impact craters, a
 * radio-telescope array, cargo stacks, a mining rig, a crashed satellite,
 * a pipeline and flags. `claim` reserves ground (Scenery.claimSpaceSpot).
 */
export function buildSpaceExtras(track: Track, group: THREE.Group, claim: (x: number, z: number, r: number) => boolean): { update(time: number): void } {
  const rand = rng(4242)
  const ids: number[] = []
  for (let i = 0; i < track.sampleCount; i++) if (track.zoneOfSample(i) === 'space') ids.push(i)
  /** A spot on the plateau `off` metres beside sample i (plateau top height). */
  const spot = (i: number, off: number): THREE.Vector3 => {
    const p = track.samples[i]!, r = rightAt(track, i)
    return new THREE.Vector3(p.x + r.x * off, p.y - 0.12, p.z + r.z * off)
  }
  const pick = (r: number, minOff: number, maxOff: number, tries = 60): THREE.Vector3 | null => {
    for (let k = 0; k < tries; k++) {
      const i = ids[Math.floor(rand() * ids.length)]!
      const off = (rand() < 0.5 ? -1 : 1) * (minOff + rand() * (maxOff - minOff))
      const s = spot(i, off)
      if (claim(s.x, s.z, r)) return s
    }
    return null
  }
  const regolith = new THREE.Color(0.85, 0.84, 0.82)

  // Scanned lunar rocks (pebble scans scaled up into boulders)
  const rocks: PropName[] = ['moon_rock_01', 'moon_rock_02', 'moon_rock_03', 'moon_rock_04', 'moon_rock_05', 'moon_rock_06', 'moon_rock_07']
  for (const name of rocks) {
    const mats: THREE.Matrix4[] = []
    for (let k = 0; k < 30; k++) {
      const big = rand() < 0.25
      const s = big ? 25 + rand() * 30 : 6 + rand() * 14
      const p = pick(big ? 3 : 1, 14, 58, 12)
      if (p) mats.push(at(p.x, p.y - 0.02 * s, p.z, rand() * 6.3, s, rand() * 0.3, rand() * 6))
    }
    props.place(name, mats, group, { tint: regolith })
  }

  // Real NASA hardware, standing at true-ish size round the base
  const nasa = (file: string, n: number, h: number, r: number, minOff = 18, maxOff = 54) => {
    const spots: { x: number; y: number; z: number; yaw: number }[] = []
    for (let k = 0; k < n; k++) {
      const p = pick(r, minOff, maxOff, 80)
      if (p) spots.push({ x: p.x, y: p.y, z: p.z, yaw: rand() * 6.3 })
    }
    props.fit(`nasa/${file}.glb`, spots, h, group)
  }
  nasa('lunar_module', 3, 7, 6)
  nasa('perseverance', 3, 2.6, 4, 15, 40)
  nasa('viking', 2, 2.6, 3, 15, 40)
  nasa('astronaut', 8, 1.9, 1.5, 14, 30)
  nasa('habitat1', 2, 6, 7)
  nasa('habitat2', 2, 6, 7)
  nasa('dsn34', 2, 32, 14, 36, 54)
  nasa('crawler', 1, 7, 16, 30, 50)
  nasa('launcher', 1, 110, 12, 40, 54)
  nasa('saturn_v', 1, 100, 6, 30, 54)
  // and orbiting overhead
  {
    const mid = track.samples[ids[Math.floor(ids.length / 2)]!]!
    props.fit('nasa/hubble.glb', [{ x: mid.x + 30, y: mid.y + 70, z: mid.z - 40, yaw: 0.6 }], 26, group)
    props.fit('nasa/lro.glb', [{ x: mid.x - 80, y: mid.y + 60, z: mid.z + 30, yaw: 2 }], 12, group)
  }

  // Impact craters: a dark floor with ejecta rays and a raised rim
  const floorTex = canvasTexture(256, 256, (g, w) => {
    const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    gr.addColorStop(0, 'rgba(40,40,42,0.9)')
    gr.addColorStop(0.55, 'rgba(70,70,72,0.7)')
    gr.addColorStop(0.85, 'rgba(160,158,154,0.4)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.fillRect(0, 0, w, w)
    g.strokeStyle = 'rgba(200,198,194,0.25)'
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2
      g.lineWidth = 2 + Math.random() * 4
      g.beginPath()
      g.moveTo(w / 2 + Math.cos(a) * w * 0.3, w / 2 + Math.sin(a) * w * 0.3)
      g.lineTo(w / 2 + Math.cos(a) * w * 0.5, w / 2 + Math.sin(a) * w * 0.5)
      g.stroke()
    }
  })
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 })
  const rimGeo = lumpy(new THREE.TorusGeometry(1, 0.3, 8, 36), 0.08, 2.2, 3)
  rimGeo.rotateX(Math.PI / 2)
  const rims: THREE.Matrix4[] = []
  for (let k = 0; k < 28; k++) {
    const R = 3 + Math.pow(rand(), 2) * 11
    const p = pick(R + 1, R + 13, 60, 10)
    if (!p) continue
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R * 1.5, 32), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.copy(p).setY(p.y + 0.03)
    floor.receiveShadow = true
    group.add(floor)
    rims.push(trs(p.x, p.y - R * 0.04, p.z, rand() * 6, new THREE.Vector3(R * 1.15, R * 0.35, R * 1.15)))
  }
  group.add(instanced(rimGeo, new THREE.MeshStandardMaterial({ color: 0xa8a5a0, roughness: 1 }), rims))

  // Radio telescope array: three dishes on alt-az mounts, aimed alike
  const white = new THREE.MeshStandardMaterial({ color: 0xe4e6e8, roughness: 0.45, metalness: 0.4 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.8 })
  const heads: THREE.Object3D[] = []
  for (let k = 0; k < 3; k++) {
    const p = pick(13, 30, 52, 120)
    if (!p) continue
    const g = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4.5, 2, 16), steel)
    base.position.y = 1
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 9, 12), white)
    pedestal.position.y = 6.5
    const head = new THREE.Group()
    head.position.y = 11.5
    const dish = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 10, 0, Math.PI * 2, 0, Math.PI / 4.2), white)
    dish.rotation.x = Math.PI
    dish.position.y = 6.5
    const back = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 3, 12), steel)
    back.position.y = -0.5
    const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 6), steel)
    feed.position.y = 3.2
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1, 10), white)
    tip.position.y = 6.3
    const tilt = new THREE.Group()
    tilt.add(dish, back, feed, tip)
    tilt.rotation.x = -0.8
    head.add(tilt)
    g.add(base, pedestal, head)
    g.position.copy(p)
    g.rotation.y = 1.1
    g.traverse((o) => { o.castShadow = true; o.receiveShadow = true })
    group.add(g)
    heads.push(head)
  }

  // Cargo container stacks
  const corrugated = canvasTexture(128, 64, (g, w, h) => {
    for (let x = 0; x < w; x += 8) { g.fillStyle = x % 16 ? '#ffffff' : '#c8c8c8'; g.fillRect(x, 0, 8, h) }
  })
  corrugated.wrapS = corrugated.wrapT = THREE.RepeatWrapping
  const box = new THREE.BoxGeometry(2.5, 2.6, 6.1)
  const colors = [0xc0392b, 0x2e6da4, 0xe2a12b, 0xdedede, 0x3b7d4f]
  for (let s = 0; s < 3; s++) {
    const p = pick(10, 20, 56)
    if (!p) continue
    const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = []
    const yaw = rand() * 6
    for (let k = 0; k < 9; k++) {
      const col = k % 3, row = Math.floor(k / 3)
      if (row === 2 && rand() < 0.5) continue
      const lx = (col - 1) * 2.7, ly = 1.3 + row * 2.62
      mats.push(trs(p.x + Math.cos(yaw) * lx, p.y + ly, p.z - Math.sin(yaw) * lx, yaw + (rand() - 0.5) * 0.05))
      cols.push(new THREE.Color(colors[Math.floor(rand() * colors.length)]!))
    }
    group.add(instanced(box, new THREE.MeshStandardMaterial({ map: corrugated, roughness: 0.6, metalness: 0.4 }), mats, cols))
  }

  // Regolith mining rig: lattice derrick, spinning drill, hopper and ore pile
  let drill: THREE.Object3D | null = null
  {
    const p = pick(12, 26, 50, 120)
    if (p) {
      const g = new THREE.Group()
      const leg = new THREE.CylinderGeometry(0.25, 0.25, 26, 6)
      for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]] as const) {
        const m = new THREE.Mesh(leg, steel)
        m.position.set(x * 0.7, 13, z * 0.7)
        m.rotation.set(z * -0.04, 0, x * 0.04)
        g.add(m)
      }
      for (let h = 3; h < 26; h += 4) {
        const ring = new THREE.Mesh(new THREE.BoxGeometry(4.6 - h * 0.08, 0.2, 4.6 - h * 0.08), steel)
        ring.position.y = h
        g.add(ring)
      }
      const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a419, roughness: 0.5, metalness: 0.3 })
      drill = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.2, 10, 10), yellow)
      drill.position.y = 6
      const hopper = new THREE.Mesh(new THREE.CylinderGeometry(3, 1, 4, 12), yellow)
      hopper.position.set(8, 6, 0)
      const hopLegs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 4, 0.4), steel)
      hopLegs.position.set(8, 2, 0)
      const belt = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 9), new THREE.MeshStandardMaterial({ color: 0x222222 }))
      belt.position.set(4, 7.5, 0)
      belt.rotation.set(0, Math.PI / 2, 0.35)
      const pile = new THREE.Mesh(lumpy(new THREE.ConeGeometry(4, 3, 14, 3), 0.4, 0.6, 2), new THREE.MeshStandardMaterial({ color: 0x77736d, roughness: 1, flatShading: true }))
      pile.position.set(-7, 1.4, 2)
      g.add(drill, hopper, hopLegs, belt, pile)
      g.position.copy(p)
      g.traverse((o) => { o.castShadow = true; o.receiveShadow = true })
      group.add(g)
    }
  }

  // A crashed satellite in its own impact scar
  {
    const p = pick(9, 22, 55, 120)
    if (p) {
      const g = new THREE.Group()
      const gold = new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.35, metalness: 0.9 })
      const panel = new THREE.MeshStandardMaterial({ color: 0x1b2a55, roughness: 0.3, metalness: 0.6 })
      const bus = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 3), gold)
      const arm = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 2), panel)
      arm.position.set(4.2, 0, 0)
      arm.rotation.z = 0.4
      const arm2 = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 2), panel)
      arm2.position.set(-4, -0.6, 0.4)
      arm2.rotation.set(0.3, 0.2, -0.9)
      const ant = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3), white)
      ant.position.set(0, 1.6, 0)
      g.add(bus, arm, arm2, ant)
      g.position.copy(p).setY(p.y + 0.6)
      g.rotation.set(0.5, rand() * 6, 0.35)
      g.traverse((o) => { o.castShadow = true })
      group.add(g)
      const scar = new THREE.Mesh(new THREE.CircleGeometry(7, 24), floorMat)
      scar.rotation.x = -Math.PI / 2
      scar.position.copy(p).setY(p.y + 0.04)
      group.add(scar)
    }
  }

  // Pipeline on trestles along a stretch of the road
  {
    const pipe: THREE.Matrix4[] = [], trestle: THREE.Matrix4[] = []
    const start = Math.floor(ids.length * 0.35), end = Math.floor(ids.length * 0.62)
    let prev: THREE.Vector3 | null = null
    const clearOfRoad = (v: THREE.Vector3) => track.samples.every((q) => (q.x - v.x) ** 2 + (q.z - v.z) ** 2 > 14 * 14 || Math.abs(q.y - v.y) > 12)
    for (let k = start; k < end; k += 6) {
      const s = spot(ids[k]!, -17)
      if (!clearOfRoad(s)) { prev = null; continue }
      if (prev) {
        const len = prev.distanceTo(s)
        const mid = prev.clone().lerp(s, 0.5)
        const m = new THREE.Matrix4().lookAt(prev, s, new THREE.Vector3(0, 1, 0))
        const q = new THREE.Quaternion().setFromRotationMatrix(m)
        pipe.push(new THREE.Matrix4().compose(mid.setY(mid.y + 1.6), q, new THREE.Vector3(1, 1, len)))
      }
      if ((k - start) % 18 === 0) trestle.push(trs(s.x, s.y, s.z, 0))
      prev = s
    }
    const pg = new THREE.CylinderGeometry(0.45, 0.45, 1, 10)
    pg.rotateX(Math.PI / 2)
    const tgeo = new THREE.BoxGeometry(0.3, 1.6, 1.2)
    tgeo.translate(0, 0.8, 0)
    group.add(instanced(pg, new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.4, metalness: 0.6 }), pipe))
    group.add(instanced(tgeo, steel, trestle))
  }

  // Flags planted beside the run
  const flagTex = canvasTexture(256, 160, (g, w, h) => {
    g.fillStyle = '#f2f2f2'
    g.fillRect(0, 0, w, h)
    g.fillStyle = '#c8202e'
    g.fillRect(0, h * 0.7, w, h * 0.3)
    g.fillStyle = '#132a4f'
    g.font = 'italic 800 64px "Barlow Condensed", Arial'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('HORIZON', w / 2, h * 0.38)
  })
  for (let k = 0; k < 5; k++) {
    const p = pick(1.5, 14, 20)
    if (!p) continue
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), steel)
    pole.position.copy(p).setY(p.y + 1.6)
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide }))
    flag.position.copy(p).add(new THREE.Vector3(0.8, 2.7, 0))
    group.add(pole, flag)
  }

  return {
    update(time: number): void {
      if (drill) drill.rotation.y = time * 4
      heads.forEach((h, k) => { h.rotation.y = Math.sin(time * 0.05 + k) * 0.6 })
    },
  }
}
