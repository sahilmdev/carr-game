import * as THREE from 'three'
import { softDot } from '../game/biomes/kit'
import type { Circuit } from './Circuit'
import type { Racer } from './Racer'
import type { Hit, World } from './World'

/**
 * Items: rows of crystals across the road hand out one item each. What you
 * get depends on where you are: leaders get defence, the back of the pack
 * gets speed and things that chase.
 */
export type ItemKind = 'turbo' | 'triple' | 'dart' | 'seeker' | 'mine' | 'shield' | 'comet' | 'storm'
export const ITEM_KINDS: ItemKind[] = ['turbo', 'triple', 'dart', 'seeker', 'mine', 'shield', 'comet', 'storm']

/** Odds by place: front, middle, back. */
const ODDS: Record<'front' | 'mid' | 'back' | 'last', [ItemKind, number][]> = {
  front: [['mine', 0.35], ['shield', 0.25], ['dart', 0.3], ['turbo', 0.1]],
  mid: [['dart', 0.28], ['seeker', 0.22], ['turbo', 0.22], ['mine', 0.14], ['shield', 0.14]],
  back: [['triple', 0.3], ['seeker', 0.25], ['comet', 0.2], ['turbo', 0.15], ['storm', 0.1]],
  // dead last: the real catch-up items. Comet: a long untouchable rocket run.
  // Storm: lightning on everyone ahead of you. A turbo comes as a pair.
  last: [['comet', 0.35], ['storm', 0.25], ['triple', 0.25], ['seeker', 0.15]],
}

const ROLL = 1.1
const RESPAWN = 2.6
const SPACING = 5
const DART_SPEED = 92
const SEEKER_SPEED = 96

export interface Held { kind: ItemKind | null; count: number; roll: number; hold: number; waited: number }

interface Box { c: Circuit; i: number; lat: number; pos: THREE.Vector3; back: number }

interface Shot {
  kind: 'dart' | 'seeker' | 'mine'
  pos: THREE.Vector3
  vel: THREE.Vector3
  vy: number
  owner: Racer
  age: number
  life: number
  bounces: number
  target: Racer | null
  path: Circuit
  pi: number
  lat: number
  mesh: THREE.Object3D
}

export type ItemEvent = 'pickup' | 'got' | 'use' | 'boom' | 'blocked'

const hit: Hit = { nx: 0, nz: 0, depth: 0 }
const under = { i: -1, lat: 0, y: 0 }
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3()
const tmp = new THREE.Vector3(), fwd = new THREE.Vector3()

export class Items {
  readonly group = (() => { const g = new THREE.Group(); g.userData['keep'] = true; return g })()
  private readonly boxes: Box[] = []
  private readonly crystals: THREE.InstancedMesh
  private readonly cores: THREE.InstancedMesh
  private readonly crystalMat: THREE.ShaderMaterial
  private readonly shots: Shot[] = []
  private readonly held = new Map<Racer, Held>()
  private readonly bubbles = new Map<Racer, THREE.Mesh>()
  private readonly bubbleMat: THREE.ShaderMaterial
  private readonly flashes: { s: THREE.Sprite; t: number }[] = []
  private readonly dot = softDot()
  onEvent: (ev: ItemEvent, r: Racer, kind: ItemKind | null, at?: THREE.Vector3) => void = () => undefined

  constructor(root: THREE.Group, private readonly main: Circuit, private readonly world: World, private readonly rand: () => number) {
    root.add(this.group)
    // a track that doesn't place its own rows gets three, on straight road
    // well clear of any jump
    if (!main.all.some((c) => c.items.length)) {
      const n = main.count
      for (const at of [0.12, 0.45, 0.75]) {
        let best = -1, score = 1e9
        for (let k = -90; k <= 90; k++) {
          const i = (Math.floor(n * at) + k + n) % n
          let nearGap = false
          for (let q = -40; q <= 40 && !nearGap; q += 4) nearGap = !!main.gap[(i + q + n) % n]
          if (nearGap) continue
          const s = Math.abs(main.bends[i]!) * 4000 + Math.abs(k) * 0.05
          if (s < score) { score = s; best = i }
        }
        if (best >= 0) main.items.push(best)
      }
    }
    // every side road long enough gets a row of its own, halfway along on its
    // straightest stretch: taking the other way never means missing out on items
    for (const b of main.branches) {
      if (b.items.length || b.count < 50) continue
      let best = -1, score = 1e9
      for (let i = Math.floor(b.count * 0.3); i < Math.floor(b.count * 0.7); i++) {
        let bad = false
        for (let q = -12; q <= 12 && !bad; q += 3) { const j = i + q; bad = j < 0 || j >= b.count || !!b.gap[j] || !!b.roll[j] || b.pipe[j]! > 0 }
        if (bad) continue
        const sc = Math.abs(b.bends[i]!) * 4000 + Math.abs(i - b.count / 2) * 0.02
        if (sc < score) { score = sc; best = i }
      }
      if (best >= 0) b.items.push(best)
    }
    // crystals: a rotating faceted gem, its colour running through the spectrum
    for (const c of main.all) for (const i of c.items) {
      const half = c.widths[i]! / 2 - 2.5, k = Math.floor(half / SPACING)
      for (let j = -k; j <= k; j++) {
        const lat = j * SPACING, p = c.samples[i]!, r = c.rights[i]!
        this.boxes.push({ c, i, lat, pos: new THREE.Vector3(p.x + r.x * lat, p.y + lat * Math.tan(c.banks[i]!) + 1.5, p.z + r.z * lat), back: 0 })
      }
    }
    this.crystalMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uT;
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
          vec3 c = hue(fract(uT * 0.12 + dot(vN, vec3(0.31, 0.47, 0.22)) * 0.6 + vW.y * 0.02));
          vec3 col = c * (0.55 + f * 2.6) + vec3(1.0) * pow(f, 3.0) * 1.4;
          gl_FragColor = vec4(col, 0.42 + f * 0.5);
        }`,
    })
    const n = Math.max(1, this.boxes.length)
    this.crystals = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.25, 0), this.crystalMat, n)
    this.cores = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.4), toneMapped: false }), n)
    for (const m of [this.crystals, this.cores]) {
      m.count = this.boxes.length
      m.frustumCulled = false
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(m)
    }
    this.spinCrystals(0, 0)
    this.bubbleMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); vP = position;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uT;
        varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main() {
          float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
          float hex = smoothstep(0.85, 1.0, abs(sin(vP.x * 3.0 + uT * 2.0) * sin(vP.y * 3.0) * sin(vP.z * 3.0 - uT)));
          gl_FragColor = vec4(vec3(0.3, 0.75, 1.6) * (f * 1.4 + hex * 0.35), 1.0);
        }`,
    })
  }

  /** Keep the crystals turning outside a race (grid, countdown, menus). */
  idle(time: number): void {
    this.crystalMat.uniforms['uT']!.value = time
    this.spinCrystals(0, time)
  }

  held_(r: Racer): Held {
    let h = this.held.get(r)
    if (!h) { h = { kind: null, count: 0, roll: 0, hold: 0, waited: 0 }; this.held.set(r, h) }
    return h
  }

  /** What a racer is carrying: for the HUD. */
  carrying(r: Racer): Held { return this.held_(r) }

  clear(): void {
    for (const s of this.shots) this.group.remove(s.mesh)
    this.shots.length = 0
    this.held.clear()
    for (const b of this.boxes) b.back = 0
    for (const m of this.bubbles.values()) this.group.remove(m)
    this.bubbles.clear()
  }

  /**
   * One frame. `order` is the running order, leader first. The player's
   * button press arrives as `use` (pressed this frame) and `back` (aiming
   * behind).
   */
  update(dt: number, time: number, order: Racer[], player: Racer | null, use: boolean, back: boolean): void {
    this.crystalMat.uniforms['uT']!.value = time
    this.bubbleMat.uniforms['uT']!.value = time
    this.spinCrystals(dt, time)
    for (const r of order) {
      if (r.rescue > 0) continue
      this.pickup(r, order)
      const h = this.held_(r)
      if (h.roll > 0) {
        h.roll -= dt
        if (h.roll <= 0) { h.roll = 0; this.onEvent('got', r, h.kind) }
        continue
      }
      if (!h.kind) continue
      if (r === player) { if (use) this.use(r, h, order, back) }
      else this.think(r, h, order, dt)
    }
    this.moveShots(dt, order)
    this.updateBubbles(order)
    this.updateFlashes(dt)
  }

  private spinCrystals(dt: number, time: number): void {
    this.boxes.forEach((b, k) => {
      b.back = Math.max(0, b.back - dt)
      const grow = b.back > 0 ? 0 : 1, s = b.back > 0 ? 0.001 : Math.min(1, 1 - b.back + 0) * grow
      e.set(time * 0.9 + k, time * 1.3 + k * 0.7, 0.4)
      q.setFromEuler(e)
      tmp.copy(b.pos)
      tmp.y += Math.sin(time * 2.2 + k) * 0.25
      m4.compose(tmp, q, one.setScalar(s))
      this.crystals.setMatrixAt(k, m4)
      e.set(-time * 2, time * 1.5, 0)
      q.setFromEuler(e)
      m4.compose(tmp, q, one.setScalar(s))
      this.cores.setMatrixAt(k, m4)
    })
    this.crystals.instanceMatrix.needsUpdate = true
    this.cores.instanceMatrix.needsUpdate = true
  }

  private pickup(r: Racer, order: Racer[]): void {
    const p = r.car.position
    for (const b of this.boxes) {
      if (b.back > 0) continue
      const dx = p.x - b.pos.x, dz = p.z - b.pos.z
      if (dx * dx + dz * dz > 2.7 * 2.7 || Math.abs(p.y + 1.2 - b.pos.y) > 3) continue
      b.back = RESPAWN
      this.flash(b.pos, 0xffffff, 5, 0.35)
      const h = this.held_(r)
      this.onEvent('pickup', r, null, b.pos)
      if (h.kind || h.roll > 0) continue
      h.kind = this.draw(order.indexOf(r), order.length)
      const last = order.length > 2 && order.indexOf(r) === order.length - 1
      h.count = h.kind === 'triple' ? 3 : h.kind === 'turbo' && last ? 2 : 1
      h.roll = ROLL
      h.hold = 0.4 + this.rand() * 2.2
      h.waited = 0
    }
  }

  private draw(place: number, of: number): ItemKind {
    const u = of > 1 ? place / (of - 1) : 0
    const table = ODDS[of > 2 && place === of - 1 ? 'last' : u < 0.2 ? 'front' : u < 0.7 ? 'mid' : 'back']
    let x = this.rand()
    for (const [k, w] of table) { if ((x -= w) <= 0) return k }
    return table[0]![0]
  }

  /** A rival with an item: when to use it. */
  private think(r: Racer, h: Held, order: Racer[], dt: number): void {
    h.hold -= dt
    h.waited += dt
    if (h.hold > 0 || r.air) return
    const p = r.car.position, f = r.car.getForwardDir(fwd)
    const place = order.indexOf(r)
    const near = (dir: number, max: number, cone: number): boolean => order.some((o) => {
      if (o === r || o.rescue > 0) return false
      const dx = o.car.position.x - p.x, dz = o.car.position.z - p.z, d = Math.hypot(dx, dz)
      return d > 4 && d < max && (dx * f.x + dz * f.z) * dir / d > cone
    })
    let go = false, back = false
    switch (h.kind) {
      case 'turbo': case 'triple': {
        const [c, i] = r.ahead(25)
        go = c.safe[i]! > 52 && !c.gap[i]
        break
      }
      case 'shield': go = true; break
      case 'storm': go = true; break
      case 'comet': {
        const [c, i] = r.ahead(25)
        go = !c.gap[i] || h.waited > 4
        break
      }
      case 'seeker': go = place > 0 || h.waited > 6; break
      case 'dart':
        if (near(1, 80, 0.96)) go = true
        else if (near(-1, 30, 0.96)) { go = true; back = true }
        else go = h.waited > 9
        break
      case 'mine': go = near(-1, 45, 0.8) || h.waited > 7; break
    }
    if (go) this.use(r, h, order, back)
  }

  private use(r: Racer, h: Held, order: Racer[], back: boolean): void {
    const kind = h.kind!
    const car = r.car, p = car.position, f = car.getForwardDir(fwd)
    switch (kind) {
      case 'turbo': case 'triple':
        car.kick(kind === 'turbo' ? 1.7 : 1.3)
        car.setSpeed(Math.max(car.getSpeed(), car.topSpeed * 1.08))
        break
      case 'shield':
        r.shield = 10
        break
      case 'comet':
        // a long rocket run: way over top speed for four seconds, and nothing can touch you
        car.kick(4.2)
        car.setSpeed(Math.max(car.getSpeed(), car.topSpeed * 1.3))
        r.shield = Math.max(r.shield, 4.4)
        r.cometT = 4.2
        break
      case 'storm':
        // lightning: everyone ahead of you spins out where they are (shields still save them)
        for (const o of order.slice(0, order.indexOf(r))) {
          if (o.cometT > 0) continue
          if (o.struck()) this.flash(o.car.position, 0xfff2a0, 10, 0.5)
        }
        break
      case 'dart': {
        const dir = back ? -1 : 1
        this.spawn('dart', r, tmp.copy(p).addScaledVector(f, dir * 3.5), f.clone().multiplyScalar(dir * DART_SPEED), null)
        break
      }
      case 'seeker': {
        const place = order.indexOf(r)
        const target = place > 0 ? order[place - 1]! : null
        this.spawn('seeker', r, tmp.copy(p).addScaledVector(f, 3.5), f.clone().multiplyScalar(SEEKER_SPEED), target)
        break
      }
      case 'mine':
        this.spawn('mine', r, tmp.copy(p).addScaledVector(f, -4.2), new THREE.Vector3(), null)
        break
    }
    this.onEvent('use', r, kind)
    h.count--
    if (h.count <= 0) { h.kind = null; h.count = 0 }
    else h.hold = 1.1
  }

  private spawn(kind: Shot['kind'], owner: Racer, at: THREE.Vector3, vel: THREE.Vector3, target: Racer | null): void {
    const mesh = this.shotMesh(kind)
    mesh.position.copy(at)
    this.group.add(mesh)
    this.shots.push({
      kind, pos: mesh.position, vel, vy: 0, owner, age: 0, life: kind === 'mine' ? 50 : kind === 'seeker' ? 9 : 4.5, bounces: 0,
      target, path: owner.path, pi: owner.pi, lat: 0, mesh,
    })
    // too many mines: the oldest goes
    const mines = this.shots.filter((s) => s.kind === 'mine')
    if (mines.length > 10) this.kill(mines[0]!, false)
  }

  private shotMesh(kind: Shot['kind']): THREE.Object3D {
    const g = new THREE.Group()
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    if (kind === 'dart') {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 1.6, 4, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 2.6, 3.2), toneMapped: false }))
      body.rotation.x = Math.PI / 2
      body.name = 'body'
      g.add(body)
      halo.material.color.setRGB(0.3, 0.9, 1.4)
      halo.scale.set(5, 5, 1)
    } else if (kind === 'seeker') {
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 0.6, 0.4), toneMapped: false })))
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.08, 6, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.4, 0.4), toneMapped: false }))
      ring.name = 'ring'
      g.add(ring)
      halo.material.color.setRGB(1.6, 0.35, 0.2)
      halo.scale.set(6.5, 6.5, 1)
    } else {
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 1), new THREE.MeshStandardMaterial({ color: 0x1c1f24, metalness: 0.8, roughness: 0.35 }))
      g.add(shell)
      const spikes = new THREE.InstancedMesh(new THREE.ConeGeometry(0.16, 0.6, 6), shell.material, 12)
      const ico = new THREE.IcosahedronGeometry(0.8, 0).getAttribute('position')
      for (let k = 0; k < 12; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(ico, k * 5).normalize()
        q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v)
        spikes.setMatrixAt(k, m4.compose(v.clone().multiplyScalar(0.8), q, one.setScalar(1)))
      }
      g.add(spikes)
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2), toneMapped: false }))
      lamp.position.y = 0.7
      lamp.name = 'lamp'
      g.add(lamp)
      halo.material.color.setRGB(1.2, 0.1, 0.05)
      halo.scale.set(2.6, 2.6, 1)
      halo.position.y = 0.7
      halo.name = 'blink'
    }
    g.add(halo)
    return g
  }

  /** The road or ground under a point, near a height. */
  private groundAt(x: number, z: number, y: number): number {
    let best = -1e9
    for (const c of this.main.all) if (c.roadAt(x, z, y, under, 3) && under.y > best) best = under.y
    return best > -1e9 ? best : this.world.terrainAt(x, z)
  }

  private moveShots(dt: number, order: Racer[]): void {
    const N = this.main.count
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const s = this.shots[k]!
      s.age += dt
      if (s.age > s.life) { this.kill(s, true); continue }
      if (s.kind === 'mine') {
        if (s.age < 0.05) s.pos.y = this.groundAt(s.pos.x, s.pos.z, s.pos.y + 2) + 0.75
        const lamp = s.mesh.getObjectByName('blink')
        if (lamp) lamp.visible = Math.sin(s.age * 9) > 0
        s.mesh.rotation.y += dt * 0.6
      } else if (s.kind === 'dart') {
        s.pos.addScaledVector(s.vel, dt)
        const g = this.groundAt(s.pos.x, s.pos.z, s.pos.y)
        if (g < s.pos.y - 7 || s.vy < 0) { s.vy -= 30 * dt; s.pos.y += s.vy * dt }
        else s.pos.y += (g + 0.9 - s.pos.y) * Math.min(1, dt * 20)
        if (s.pos.y < this.world.sea || s.pos.y < g - 2) { this.kill(s, true); continue }
        if (this.world.collide(s.pos.x, s.pos.z, s.pos.y, 0.5, hit)) {
          if (++s.bounces > 3) { this.kill(s, true); continue }
          const d = s.vel.x * hit.nx + s.vel.z * hit.nz
          s.vel.x -= 2 * d * hit.nx
          s.vel.z -= 2 * d * hit.nz
          s.pos.x += hit.nx * hit.depth
          s.pos.z += hit.nz * hit.depth
        }
        s.mesh.lookAt(tmp.copy(s.pos).add(s.vel))
      } else {
        // a seeker follows the road until it's close, then dives for its target
        const t = s.target && !s.target.finished && s.target.rescue <= 0 ? s.target : null
        const tp = t?.car.position
        if (t && tp && Math.hypot(tp.x - s.pos.x, tp.z - s.pos.z) < 30) {
          tmp.set(tp.x - s.pos.x, tp.y + 0.8 - s.pos.y, tp.z - s.pos.z).normalize()
          s.pos.addScaledVector(tmp, SEEKER_SPEED * dt)
        } else {
          const steps = SEEKER_SPEED * dt / 2
          const choice = t && t.path !== this.main ? t.path : null
          const [c, i] = advance(this.main, s.path, s.pi, steps, choice)
          s.path = c
          s.pi = i
          const sp = c.samples[Math.floor(i)]!, rt = c.rights[Math.floor(i)]!
          let want = 0
          if (tp) want = THREE.MathUtils.clamp((tp.x - sp.x) * rt.x + (tp.z - sp.z) * rt.z, -c.widths[Math.floor(i)]! / 2 + 1, c.widths[Math.floor(i)]! / 2 - 1)
          s.lat += (want - s.lat) * Math.min(1, dt * 3)
          s.pos.set(sp.x + rt.x * s.lat, sp.y + 1.1 + Math.sin(s.age * 9) * 0.15, sp.z + rt.z * s.lat)
          void N
        }
        const ring = s.mesh.getObjectByName('ring')
        if (ring) { ring.rotation.x += dt * 9; ring.rotation.y += dt * 5 }
      }
      // anyone in reach?
      for (const r of order) {
        if (r.rescue > 0 || (r === s.owner && s.age < (s.kind === 'mine' ? 0.8 : 0.5))) continue
        if (s.kind === 'seeker' && s.target && r !== s.target && s.age < 0.8) continue
        const p = r.car.position
        const reach = s.kind === 'mine' ? 2.4 : 2.5
        if ((p.x - s.pos.x) ** 2 + (p.z - s.pos.z) ** 2 > reach * reach || Math.abs(p.y + 0.8 - s.pos.y) > 2.6) continue
        const struck = r.struck()
        this.onEvent(struck ? 'boom' : 'blocked', r, null, s.pos)
        this.kill(s, true)
        break
      }
    }
  }

  private kill(s: Shot, boom: boolean): void {
    const k = this.shots.indexOf(s)
    if (k >= 0) this.shots.splice(k, 1)
    this.group.remove(s.mesh)
    s.mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose() })
    if (boom) this.flash(s.pos, s.kind === 'dart' ? 0x60e0ff : 0xff7040, 9, 0.45)
  }

  private flash(at: THREE.Vector3, color: number, size: number, t: number): void {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dot, color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    s.position.copy(at)
    s.scale.setScalar(size * 0.3)
    s.userData['size'] = size
    s.userData['t0'] = t
    this.group.add(s)
    this.flashes.push({ s, t })
  }

  private updateFlashes(dt: number): void {
    for (let k = this.flashes.length - 1; k >= 0; k--) {
      const f = this.flashes[k]!
      f.t -= dt
      const t0 = f.s.userData['t0'] as number, u = 1 - Math.max(0, f.t) / t0
      f.s.scale.setScalar((f.s.userData['size'] as number) * (0.3 + u * 0.9))
      f.s.material.opacity = 1 - u
      if (f.t <= 0) {
        this.group.remove(f.s)
        f.s.material.dispose()
        this.flashes.splice(k, 1)
      }
    }
  }

  private updateBubbles(order: Racer[]): void {
    for (const r of order) {
      let b = this.bubbles.get(r)
      if (r.shield <= 0) { if (b) b.visible = false; continue }
      if (!b) {
        b = new THREE.Mesh(new THREE.SphereGeometry(3.1, 28, 18), this.bubbleMat)
        b.scale.set(1, 0.7, 1.25)
        this.group.add(b)
        this.bubbles.set(r, b)
      }
      // flickers in its last two seconds
      b.visible = r.shield > 2 || Math.sin(r.shield * 30) > 0
      b.position.copy(r.car.position)
      b.position.y += 0.9
      b.rotation.y = r.car.heading
    }
  }
}

/** Move along the road network by a number of samples (fractional). */
function advance(main: Circuit, path: Circuit, pi: number, steps: number, choice: Circuit | null): [Circuit, number] {
  const N = main.count
  if (path !== main) {
    const j = pi + steps
    if (j < path.count - 1) return [path, j]
    return [main, (path.join!.to + (j - (path.count - 1))) % N]
  }
  if (choice?.join) {
    const d = (choice.join.from - pi + N) % N
    if (d <= steps) return [choice, steps - d]
  }
  return [main, (pi + steps) % N]
}
