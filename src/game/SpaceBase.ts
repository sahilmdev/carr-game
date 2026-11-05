import * as THREE from 'three'

/**
 * Lunar base hardware for the space plateau, all generated in code:
 * habitat domes and modules with lit windows, solar farms, a landing pad
 * with a lander, a launch pad with a rocket and service tower, a parked
 * rover and a lattice comms mast. Each builder returns a Group whose
 * origin sits on the ground, +Z facing the road.
 */

const mats = (() => {
  const white = new THREE.MeshStandardMaterial({ color: 0xd9dcdf, roughness: 0.55, metalness: 0.1 })
  const panelTex = (() => {
    // Hull panelling: soft seams and a few darker plates
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = '#d8dbde'
    g.fillRect(0, 0, 256, 256)
    for (let k = 0; k < 18; k++) {
      g.fillStyle = `rgba(80,85,90,${0.05 + Math.random() * 0.08})`
      g.fillRect(Math.floor(Math.random() * 4) * 64, Math.floor(Math.random() * 4) * 64, 64, 64)
    }
    g.strokeStyle = 'rgba(60,65,70,0.55)'
    g.lineWidth = 2
    for (let k = 0; k <= 256; k += 64) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 256); g.stroke()
      g.beginPath(); g.moveTo(0, k); g.lineTo(256, k); g.stroke()
    }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.repeat.set(3, 2)
    return t
  })()
  const hull = new THREE.MeshStandardMaterial({ color: 0xffffff, map: panelTex, roughness: 0.5, metalness: 0.15 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.45, metalness: 0.8 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.6, metalness: 0.4 })
  const gold = new THREE.MeshStandardMaterial({ color: 0xc8962e, roughness: 0.35, metalness: 0.9 }) // foil insulation
  const orange = new THREE.MeshStandardMaterial({ color: 0xd9822b, roughness: 0.6 })
  const win = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0xffd9a0, emissiveIntensity: 1.6, roughness: 0.2 })
  const solar = (() => {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = '#0d1a33'
    g.fillRect(0, 0, 128, 256)
    g.strokeStyle = '#7d8aa3'
    g.lineWidth = 1.5
    for (let x = 0; x <= 128; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke() }
    for (let y = 0; y <= 256; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke() }
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0.6 })
  })()
  const padTex = (() => {
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const g = c.getContext('2d')!
    g.fillStyle = '#5d5f62'
    g.fillRect(0, 0, 512, 512)
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,30,30' : '200,200,200'},0.06)`
      g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3)
    }
    g.strokeStyle = '#e6c84a'
    g.lineWidth = 14
    g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke()
    g.fillStyle = '#e8e8e8'
    g.font = 'bold 240px Arial'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('H', 256, 268)
    // scorch mark in the middle
    const r = g.createRadialGradient(256, 256, 10, 256, 256, 170)
    r.addColorStop(0, 'rgba(10,10,10,0.75)')
    r.addColorStop(1, 'rgba(10,10,10,0)')
    g.fillStyle = r
    g.fillRect(0, 0, 512, 512)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })
  })()
  return { white, hull, steel, dark, gold, orange, win, solar, padTex }
})()

const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = new THREE.Mesh(geo, mat)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** Two domes and a long module joined by short tunnels, windows lit. */
export function habitat(): THREE.Group {
  const g = new THREE.Group()
  const dome = (r: number, x: number, z: number) => {
    g.add(mesh(new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), mats.hull, x, 0, z))
    g.add(mesh(new THREE.CylinderGeometry(r + 0.3, r + 0.5, 0.8, 28), mats.steel, x, 0.4, z)) // footing ring
    // ring of windows round the dome
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2
      const w = mesh(new THREE.BoxGeometry(1.4, 0.7, 0.2), mats.win, x + Math.cos(a) * r * 0.9, r * 0.38, z + Math.sin(a) * r * 0.9)
      w.lookAt(x, r * 0.38, z)
      g.add(w)
    }
  }
  dome(9, -14, 0)
  dome(6.5, 15, 3)
  // long pressurised module between them
  const mod = mesh(new THREE.CylinderGeometry(2.6, 2.6, 16, 20), mats.hull, 0.5, 2.8, 1)
  mod.rotation.z = Math.PI / 2
  g.add(mod)
  for (let k = -3; k <= 3; k++) g.add(mesh(new THREE.BoxGeometry(1, 0.6, 0.15), mats.win, 0.5 + k * 2, 3.2, 3.6))
  // gold-foil insulated airlock and a radiator fin on top
  g.add(mesh(new THREE.CylinderGeometry(1.6, 1.6, 3, 14), mats.gold, -3, 1.6, 6))
  const fin = mesh(new THREE.BoxGeometry(8, 0.08, 3), mats.white, 3, 6.8, 1)
  g.add(fin)
  g.add(mesh(new THREE.BoxGeometry(0.3, 1.6, 0.3), mats.steel, 3, 5.9, 1))
  return g
}

/** A field of tilted solar panels on legs, `rows` × `cols`. */
export function solarFarm(rows = 3, cols = 5): THREE.Group {
  const g = new THREE.Group()
  const panelGeo = new THREE.BoxGeometry(3.2, 0.08, 5.6)
  const legGeo = new THREE.CylinderGeometry(0.08, 0.1, 2, 6)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * 4, z = (r - (rows - 1) / 2) * 7.5
      const p = mesh(panelGeo, mats.solar, x, 2.2, z)
      p.rotation.x = -0.45 // tilted toward the low sun
      g.add(p)
      g.add(mesh(legGeo, mats.steel, x, 1, z))
    }
  }
  return g
}

/** Landing pad with markings and a four-legged lander standing on it. */
export function landingPad(): THREE.Group {
  const g = new THREE.Group()
  g.add(mesh(new THREE.CylinderGeometry(13, 13.6, 0.5, 40), mats.padTex, 0, 0.25, 0))
  // pad edge lights
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2
    g.add(mesh(new THREE.SphereGeometry(0.22, 8, 6), mats.win, Math.cos(a) * 13.2, 0.6, Math.sin(a) * 13.2))
  }
  // lander: foil-wrapped descent stage, white crew cabin, four legs + pads
  const l = new THREE.Group()
  l.add(mesh(new THREE.CylinderGeometry(2.6, 2.6, 2.2, 8), mats.gold, 0, 2.6, 0))
  l.add(mesh(new THREE.CylinderGeometry(1.7, 2.1, 2.4, 12), mats.hull, 0, 4.9, 0))
  l.add(mesh(new THREE.ConeGeometry(1.7, 1.2, 12), mats.white, 0, 6.7, 0))
  l.add(mesh(new THREE.CylinderGeometry(0.9, 1.3, 1, 12), mats.dark, 0, 1.0, 0)) // engine bell
  l.add(mesh(new THREE.BoxGeometry(0.9, 0.5, 0.1), mats.win, 0, 5.2, 1.65))
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4
    const foot = new THREE.Vector3(Math.cos(a) * 4.2, 0.15, Math.sin(a) * 4.2)
    const hip = new THREE.Vector3(Math.cos(a) * 2.3, 2.8, Math.sin(a) * 2.3)
    const leg = mesh(new THREE.CylinderGeometry(0.12, 0.12, foot.distanceTo(hip), 6), mats.steel)
    leg.position.copy(foot).lerp(hip, 0.5)
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hip.clone().sub(foot).normalize())
    l.add(leg)
    l.add(mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.15, 12), mats.steel, foot.x, 0.1, foot.z))
  }
  l.position.y = 0.5
  g.add(l)
  return g
}

/** Launch pad: concrete deck, a tall rocket with boosters and a lattice service tower. */
export function launchPad(): THREE.Group {
  const g = new THREE.Group()
  g.add(mesh(new THREE.BoxGeometry(30, 1.2, 30), mats.dark, 0, 0.6, 0))
  g.add(mesh(new THREE.BoxGeometry(10, 0.4, 10), mats.steel, 0, 1.4, 0)) // flame deflector plate
  // Rocket: core stage, interstage, upper stage, fairing; two strap-on boosters
  const r = new THREE.Group()
  r.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 30, 24), mats.hull, 0, 15, 0))
  r.add(mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.4, 24), mats.dark, 0, 30.7, 0))
  r.add(mesh(new THREE.CylinderGeometry(2.0, 2.2, 10, 24), mats.hull, 0, 36.4, 0))
  r.add(mesh(new THREE.ConeGeometry(2.0, 6, 24), mats.white, 0, 44.4, 0))
  r.add(mesh(new THREE.CylinderGeometry(2.25, 2.25, 0.8, 24), mats.orange, 0, 22, 0))
  for (const s of [-1, 1]) {
    r.add(mesh(new THREE.CylinderGeometry(1.1, 1.1, 20, 16), mats.white, s * 3.4, 10, 0))
    r.add(mesh(new THREE.ConeGeometry(1.1, 3, 16), mats.white, s * 3.4, 21.5, 0))
    r.add(mesh(new THREE.CylinderGeometry(0.7, 1.1, 1.4, 12), mats.dark, s * 3.4, -0.6, 0))
  }
  r.add(mesh(new THREE.CylinderGeometry(1.2, 1.8, 1.6, 16), mats.dark, 0, -0.7, 0))
  r.position.y = 3
  g.add(r)
  // Service tower: four corner posts, cross bracing every 6 m, swing arm
  const tower = new THREE.Group()
  const H = 48
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) {
    tower.add(mesh(new THREE.BoxGeometry(0.4, H, 0.4), mats.orange, x, H / 2, z))
  }
  for (let y = 3; y < H; y += 6) {
    for (const [a, b] of [[0, 1], [1, 0]] as const) {
      const br = mesh(new THREE.BoxGeometry(a ? 4.4 : 0.25, 0.25, b ? 4.4 : 0.25), mats.orange, 0, y, 0)
      tower.add(br)
      const br2 = br.clone()
      br2.position.set(a ? 0 : 2, y, b ? 0 : 2)
      tower.add(br2)
      const br3 = br.clone()
      br3.position.set(a ? 0 : -2, y, b ? 0 : -2)
      tower.add(br3)
    }
    // diagonal brace on the outer face
    const d = mesh(new THREE.BoxGeometry(0.2, 7.2, 0.2), mats.orange, -2, y + 3, 0)
    d.rotation.x = 0.6
    tower.add(d)
  }
  const arm = mesh(new THREE.BoxGeometry(5.5, 1.2, 1.4), mats.steel, 4.5, 38, 0)
  tower.add(arm)
  tower.add(mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }), 0, H + 0.6, 0))
  tower.position.set(-9.5, 1.2, 0)
  g.add(tower)
  return g
}

/** Six-wheeled rover with a mast camera and a dish. */
export function rover(): THREE.Group {
  const g = new THREE.Group()
  g.add(mesh(new THREE.BoxGeometry(2.6, 0.9, 4.2), mats.white, 0, 1.6, 0))
  g.add(mesh(new THREE.BoxGeometry(2.2, 0.6, 1.6), mats.gold, 0, 2.35, -0.8))
  g.add(mesh(new THREE.BoxGeometry(3, 0.06, 2.2), mats.solar, 0, 2.15, 1.1))
  const wheel = new THREE.CylinderGeometry(0.55, 0.55, 0.45, 16)
  wheel.rotateZ(Math.PI / 2)
  for (const x of [-1.55, 1.55]) for (const z of [-1.6, 0, 1.6]) g.add(mesh(wheel, mats.dark, x, 0.55, z))
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.6, 6), mats.steel, 0.8, 2.8, -1.6))
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), mats.dark, 0.8, 3.6, -1.6))
  const dish = mesh(new THREE.SphereGeometry(0.7, 14, 6, 0, Math.PI * 2, 0, Math.PI / 3), mats.white, -0.7, 2.8, 1.2)
  dish.rotation.x = -0.9
  g.add(dish)
  return g
}

/** Lattice comms mast with dishes and a red beacon (returned for blinking). */
export function commsMast(): { group: THREE.Group; beacon: THREE.Mesh } {
  const g = new THREE.Group()
  const H = 34
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2
    const post = mesh(new THREE.CylinderGeometry(0.12, 0.2, H, 6), mats.steel, Math.cos(a) * 1.2, H / 2, Math.sin(a) * 1.2)
    g.add(post)
  }
  // triangular bracing rings up the mast
  for (let y = 2; y < H; y += 3) {
    const ring = mesh(new THREE.TorusGeometry(1.25, 0.06, 4, 3), mats.steel, 0, y, 0)
    ring.rotation.x = Math.PI / 2
    g.add(ring)
  }
  for (const [y, a] of [[24, 0.4], [29, 2.6]] as const) {
    const d = mesh(new THREE.SphereGeometry(1.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3), mats.white, Math.cos(a) * 1.6, y, Math.sin(a) * 1.6)
    d.rotation.set(-1.2, a, 0)
    g.add(d)
  }
  const beacon = mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xff2020, emissiveIntensity: 3 }), 0, H + 0.4, 0)
  g.add(beacon)
  return { group: g, beacon }
}

/** Runway-style edge lights along a road side (instanced). */
export function edgeLights(points: THREE.Vector3[]): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(0.12, 0.16, 0.35, 8)
  const mat = new THREE.MeshStandardMaterial({ color: 0x9fd0ff, emissive: 0x7fb8ff, emissiveIntensity: 2.4 })
  const m = new THREE.InstancedMesh(geo, mat, points.length)
  const d = new THREE.Object3D()
  points.forEach((p, k) => { d.position.copy(p); d.updateMatrix(); m.setMatrixAt(k, d.matrix) })
  m.computeBoundingSphere()
  return m
}
