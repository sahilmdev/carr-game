import * as THREE from 'three'
import type { Track, ZoneName } from '../Track'
import { Terrain, type TerrainField, type RoadMode } from './Terrain'
import { RoadIndex, ZoneDistance, fbm2, smooth, zoneIndices } from './kit'
import type { Biome, BuildCtx, FrameCtx, BiomeEvents } from './types'
import { Volcano } from './Volcano'
import { Canyon } from './Canyon'
import { Stadium } from './Finish'
import { buildGates, buildLandmarks } from './Spectacle'
import { Desert, STORM } from './Desert'
import { Snow } from './Snow'
import { SkyIslands } from './SkyIslands'
import { Jungle } from './Jungle'
import { NeonCity } from './NeonCity'
import { MoodTable, BlendedMood } from './Moods'
import { Particles } from './Particles'
import { props } from './Props'
import { GradeTable } from './Grade'
import { buildRhythm } from './Rhythm'
import { placeBiomeProps } from './BiomeProps'

export type { FrameCtx, BiomeEvents }

/** Zones the southern terrain is carved to (others are ignored). */
const TERRAIN_ZONES: Partial<Record<ZoneName, RoadMode>> = {
  volcano: 'fill', desert: 'fill', saltflat: 'fill', snow: 'fill', jungle: 'fill',
  sky: 'bridge', roll: 'bridge', flight3: 'bridge',
}

/**
 * The six southern biomes (volcano, desert + salt flat, alpine pass, sky
 * islands, rainforest, neon city), their shared terrain, atmosphere moods
 * and ambient particles.
 */
export class Biomes {
  readonly group = new THREE.Group()
  readonly terrain: Terrain
  readonly canyon: Canyon
  readonly stadium: Stadium
  private marks: { globe: THREE.Object3D; tree: THREE.Object3D } | null = null
  readonly volcano: Volcano
  readonly desert: Desert
  readonly snow: Snow
  readonly sky: SkyIslands
  readonly jungle: Jungle
  readonly city: NeonCity
  readonly list: Biome[]
  readonly moods: MoodTable
  readonly mood = new BlendedMood()
  readonly particles = new Particles()
  readonly lights = new THREE.Group()
  propsReady: Promise<void> = Promise.resolve()
  readonly grades: GradeTable

  constructor(private readonly track: Track, hooks: Pick<BuildCtx, 'addKicker' | 'addBoost'>) {
    this.grades = new GradeTable(track)
    this.canyon = new Canyon(track)
    this.stadium = new Stadium(track)
    this.volcano = new Volcano(track)
    this.desert = new Desert(track)
    this.snow = new Snow(track)
    this.sky = new SkyIslands(track)
    this.jungle = new Jungle(track)
    this.city = new NeonCity(track)
    this.list = [this.stadium, this.canyon, this.volcano, this.desert, this.snow, this.sky, this.jungle, this.city]

    const fields: TerrainField[] = [this.fillerField(), this.hiddenField()]
    for (const b of this.list) fields.push(...b.fields())
    // the canyon road runs into the terrain's edge just before the volcano
    const volcano0 = zoneIndices(track, 'volcano')[0]!
    this.terrain = new Terrain(track, {
      x0: -1000, z0: -1300, x1: 1300, z1: -40, step: 5,
      fields,
      bore: (x, z) => this.volcano.boreCrown(x, z),
      roadMode: (i) => {
        for (const b of this.list) {
          const m = b.roadMode?.(i)
          if (m) return m
        }
        if (i >= volcano0 - 100 && i < volcano0) return 'fill'
        return TERRAIN_ZONES[track.zoneOfSample(i)] ?? null
      },
    })
    this.group.add(this.terrain.group)

    const ctx: BuildCtx = { track, road: new RoadIndex(track, 24, true), terrain: this.terrain, ...hooks }
    for (const b of this.list) {
      b.build(ctx)
      this.group.add(b.group)
    }
    const groups = Object.fromEntries(this.list.map((b) => [b.name, b.group]))
    placeBiomeProps(ctx, groups)
    buildRhythm(ctx, groups)
    this.marks = buildLandmarks(ctx, groups)
    const inside = (i: number) => this.enclosed(i) || track.isPlankDeck(i)
    buildGates(track, groups['coast']!, ['town', 'coast', 'causeway'], 60, inside)
    buildGates(track, groups['canyon']!, ['canyon'], 70, inside)
    buildGates(track, groups['volcano']!, ['volcano'], 70, (i) => inside(i) || this.volcano.onBridge(i))
    buildGates(track, groups['desert']!, ['desert', 'saltflat'], 85, inside)
    buildGates(track, groups['snow']!, ['snow'], 75, inside)
    buildGates(track, groups['jungle']!, ['jungle'], 75, inside)
    buildGates(track, groups['city']!, ['city'], 60, inside)
    this.group.add(this.particles.group)
    /** Resolves once the scanned props have loaded (or failed). */
    this.propsReady = props.loadAll()
    // lights must never be hidden (a change in light count recompiles shaders)
    this.lights.add(this.volcano.lights)
    this.lights.userData['keepVisible'] = true

    // Atmosphere per sample; a sandstorm blows through the middle of the
    // desert, and the night look ends halfway through the city tunnel
    const desertIdx = zoneIndices(track, 'desert')
    const storm = new Set(desertIdx.slice(Math.floor(desertIdx.length * STORM[0]), Math.floor(desertIdx.length * STORM[1])))
    const tunnel = zoneIndices(track, 'city').filter((i) => this.city.inTunnel(i))
    const tunnelEnd = new Set(tunnel.slice(Math.floor(tunnel.length * 0.45)))
    let afterTunnel = false
    this.moods = new MoodTable(track, (i, zone) => {
      if (zone === 'city') {
        if (tunnelEnd.has(i)) afterTunnel = true
        return afterTunnel || tunnelEnd.has(i) ? null : 'city'
      }
      afterTunnel = false
      if (storm.has(i)) return 'sandstorm'
      if (zone === 'roll' || zone === 'flight3') return 'sky'
      if (zone === 'town' || zone === 'causeway') return 'coast'
      if (zone === 'loop') return track.samples[i]!.y > 0 ? 'canyon' : null
      return zone in { coast: 1, canyon: 1, volcano: 1, desert: 1, saltflat: 1, snow: 1, sky: 1, jungle: 1 } ? zone : null
    })
  }

  /** Rolling dry scrubland wherever no biome claims the ground. */
  private fillerField(): TerrainField {
    return {
      weight: () => 0.12,
      height: (x, z) => 2 + fbm2(x * 0.006, z * 0.006) * 10,
      color: (x, z, _h, slope, out) => {
        const n = fbm2(x * 0.03, z * 0.03)
        out.setRGB(0.55 + n * 0.08, 0.5 + n * 0.06, 0.36).lerp(new THREE.Color(0.5, 0.47, 0.42), smooth(0.4, 0.9, slope))
      },
    }
  }

  /** Keep the terrain under the grass near the town, coast, canyon and city. */
  private hiddenField(): TerrainField {
    const d = new ZoneDistance(this.track, ['town', 'coast', 'causeway', 'canyon', 'loop', 'city', 'underwater', 'rampUp'], -1000, -1300, 1300, -40, 10)
    return {
      weight: (x, z) => 4 * (1 - smooth(70, 170, d.at(x, z))),
      height: () => -6,
      color: (_x, _z, _h, _s, out) => { out.setRGB(0.3, 0.3, 0.2) },
    }
  }

  /** Is sample i inside a tunnel (for the echo)? */
  enclosed(i: number): boolean {
    return this.volcano.inTube(i) || this.city.inTunnel(i) || this.snow.inGallery(i)
  }

  /** Ice and mud: extra sideways slip and drag at sample i. */
  surface(i: number): { slip: number; drag: number } | null {
    const z = this.track.zoneOfSample(i)
    return this.snow.surface(i) ?? this.jungle.surface(i) ?? (z === 'snow' ? { slip: 0.13, drag: 0 } : z === 'underwater' ? { slip: 0.2, drag: 0 } : null)
  }

  update(f: FrameCtx, ev: BiomeEvents): void {
    this.terrain.update(f.time)
    props.cull(f.camera.position)
    for (const b of this.list) b.update(f, ev)
    if (this.marks) {
      // only over their own areas, so they never spoil the mood next door
      this.marks.globe.rotation.y = f.time * 0.12
      this.marks.globe.visible = f.zone === 'city' || f.zone === 'jungle'
      this.marks.tree.visible = f.zone === 'jungle' || f.zone === 'flight3' || f.zone === 'city'
    }
  }
}
