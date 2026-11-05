import type * as THREE from 'three'
import type { Track, ZoneName } from '../Track'
import type { RoadIndex } from './kit'
import type { Terrain, TerrainField, RoadMode } from './Terrain'
import type { SfxName, LoopName } from '../Sfx'

export interface BuildCtx {
  track: Track
  road: RoadIndex
  terrain: Terrain
  /** Register a low-gravity / normal-gravity kicker ramp at a sample. */
  addKicker(i: number, gravity: number): void
  /** Register a boost pad / ring: lateral centre and half-width. */
  addBoost(i: number, lat: number, half: number): void
}

export interface FrameCtx {
  time: number
  dt: number
  camera: THREE.Camera
  carPos: THREE.Vector3
  carIdx: number
  carSpeed: number
  zone: ZoneName
  /** Night level 0–1 (time of day). */
  night: number
}

/** Things a biome can tell the game about while racing. */
export interface BiomeEvents {
  /** Hit by a hazard (lava bomb, traffic): 0–1 strength. */
  hit(strength: number): void
  /** Short HUD message. */
  toast(text: string, kind?: 'info' | 'best'): void
  /** Meter at the top of the screen: label (null hides it), 0–1 level, CSS colour; soft = no red screen edge. */
  danger(label: string | null, level: number, color: string, soft?: boolean): void
  /** Play a sound: 0–1 loudness, pitch in semitones. */
  sfx(name: SfxName, vol?: number, pitch?: number): void
  /** Set a looping sound's level (0 = off). */
  loop(name: LoopName, level: number): void
  /** Add nitro (0–1). */
  nitro(amount: number): void
  /** Shove the car sideways by this many metres. */
  push(x: number, z: number): void
  /** Ground shake. */
  rumble(amount: number): void
  /** Full nitro. */
  refill(): void
  /** Slipstreaming behind traffic started / stopped. */
  draft(on: boolean): void
}

export interface Biome {
  readonly name: string
  readonly group: THREE.Group
  fields(): TerrainField[]
  /** Override how the ground meets the road at sample i. */
  roadMode?(i: number): RoadMode | undefined
  build(ctx: BuildCtx): void
  update(f: FrameCtx, ev: BiomeEvents): void
  /** Grip loss 0–1 and drag (per second) at sample i, for ice and mud. */
  surface?(i: number): { slip: number; drag: number } | null
}
