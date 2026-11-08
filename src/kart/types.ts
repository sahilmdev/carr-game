import type * as THREE from 'three'
import type { TimeOfDay } from '../game/Sky'
import type { World } from './World'
import type { Circuit } from './Circuit'
import type { Dresser } from './dress'
import type { TerrainStyle } from './art/terrain'
import type { WaterStyle, Water } from './art/water'
import type { RoadControl } from './Build'

export type Deck = 'asphalt' | 'dirt' | 'wood' | 'ice' | 'steel' | 'glass'
export const DECKS: Deck[] = ['asphalt', 'dirt', 'wood', 'ice', 'steel', 'glass']

export interface PointOpts {
  /** Road width here (m). */
  w?: number
  /** Stands clear of the ground: bridges and viaducts. */
  raised?: boolean
  /** Low rails on the left, right or both ('L', 'R', 'LR', '' for none). */
  rail?: string
  /** How much this bend leans (default from the track). */
  bank?: number
  /** Nothing here: the car has to fly it. */
  gap?: boolean
  /** What the road is made of from here. */
  deck?: Deck
  /** A boost strip here, at this many metres right of centre (0 if true). */
  pad?: boolean | number
  /** Over this gap, wings come out: a long, steerable glide down. */
  glide?: boolean
  /** A row of item crystals across the road here. */
  items?: boolean
  /** Inside the hill: not carved into the ground, no supports. The track builds the bore. */
  tunnel?: boolean
}

/**
 * A second road that leaves the loop at one control point and rejoins it at
 * another: a fork or a shortcut. Its points run between those two.
 */
export interface BranchDef {
  from: number
  to: number
  points: TrackPoint[]
  /** Chance a rival takes it (0-1, default 0.5). */
  odds?: number
  name?: string
}

export type TrackPoint = [number, number, number, PointOpts?]

export type Surface = 'grass' | 'sand' | 'mud' | 'snow' | 'concrete'

export interface LookDef {
  tod: TimeOfDay
  rain?: boolean
  /** Sky tint: colours in linear 0–1 and how strongly they apply. */
  top?: [number, number, number]
  horizon?: [number, number, number]
  mix?: number
  stars?: number
  fog: [number, number, number]
  fogDensity: number
  exposure?: number
  sun?: number
  hemi?: number
  bloom?: number
  /** Road sheen: 0 dry, 1 soaking. */
  wet?: number
  headlights?: number
  /** Use the generated sky rather than the photograph for this time of day. */
  generatedSky?: boolean
  /** Fog pools below this height, thinning at this rate per metre. */
  fogBase?: number
  fogFall?: number
  /** Warm glow in the air towards the sun, 0 to 1. */
  sunGlow?: number
  /** Light shafts round the sun on screen, 0 to 1. */
  shafts?: number
  /** Hide the sky: the track draws its own surroundings. */
  noSky?: boolean
  /** Scales light and reflections from the sky. */
  env?: number
  /** Dancing light on everything, as under water. */
  caustics?: number
  /** Saturation, contrast, shadow lift rgb, highlight gain rgb, vignette. */
  grade?: [number, number, number, number, number, number, number, number, number]
}

export interface RoadStyle {
  /** 'circuit' has kerbs on the bends; 'highway' a centre dash; 'plain' neither. */
  lines?: 'circuit' | 'highway' | 'plain'
  kerb?: boolean
  kerbColors?: [number, number]
  edgeLine?: number
  /** Dust gathered at the edges. */
  grime?: number
  tone?: number
  /** Photo set used for dirt decks. */
  dirt?: string
  /** Glow the wet road picks up at a low angle, from the lights around it. */
  sheen?: number
  /** Adds to the road's brightness (a low sun leaves it near black). */
  lift?: number
}

export interface TrackDef {
  id: string
  name: string
  /** Ambient sound area (from Sfx). */
  ambience: string
  points: TrackPoint[]
  /** Forks and shortcuts off the main loop. */
  branches?: BranchDef[]
  width: number
  rail?: string
  bank?: number
  /** How wide the slope is where the road meets the ground (m). */
  shoulder?: number
  look: LookDef
  /** The track's colour in menus and signs. */
  accent: number
  /** Below this height racers are rescued: sea, or the open air under the road. */
  sea?: number
  /** Show water at that height. */
  water?: WaterStyle
  road?: RoadStyle
  /** Look of the track's low rails. */
  rails?: 'steel' | 'wood' | 'none'
  /** Supports under raised road; 'none' when the track builds its own. */
  piers?: 'concrete' | 'none'
  /** Steepest lean a bend may have (default 0.2). */
  maxBank?: number
  /** Default surface for the road. */
  deck?: Deck
  /** Pull towards the ground in m/s² (default 26; less for long, floaty jumps). */
  gravity?: number
  /** Natural ground height before the road is carved in. */
  ground(x: number, z: number): number
  terrain?: TerrainStyle
  /** Don't draw ground lower than this. */
  groundBelow?: number
  /** Colour of the plain running out to the horizon past the edge of the map. */
  far?: number
  farY?: number
  /** Layer weights for the ground here, and a colour tint (starts white). */
  splat?(x: number, z: number, h: number, slope: number, roadDist: number, mix: number[], tint: THREE.Color): void
  surfaceAt?(x: number, z: number): Surface
  build(c: BuildKit): void | Promise<void>
}

export interface BuildKit {
  track: TrackDef
  world: World
  circuit: Circuit
  root: THREE.Group
  d: Dresser
  road: RoadControl
  water: Water | null
  /** Called every frame: scenery that moves, and what changes by lap. */
  onFrame(fn: (f: FrameInfo) => void): void
}

export interface FrameInfo {
  time: number
  dt: number
  /** Leader's lap, from 1. */
  lap: number
  totalLaps: number
  camera: THREE.Camera
  /** Racer positions, player first. */
  player: THREE.Vector3
}
