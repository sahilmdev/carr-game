import type { ZoneName } from './Track'
import type { CarConfig } from './Car'

/**
 * Everything the lobby offers: cars, tracks and cups. Only the Grand Tour can
 * be raced so far; the rest exist so the menus can be tried before the tracks
 * are built.
 */
export interface CarInfo {
  id: string
  name: string
  blurb: string
  /** Asset name; `file` is loaded on demand, the rest come with the game. */
  model: string
  file?: string
  hq?: boolean
  stats: Partial<CarConfig>
  /** 1–5 for the bars on the car screen. */
  bars: { speed: number; accel: number; grip: number; drift: number }
}

export const CARS: CarInfo[] = [
  { id: 'rotor', name: 'Rotor GT', blurb: 'The all-rounder. Nothing to hide behind, nothing to fear.', model: 'carHQ', hq: true, stats: {}, bars: { speed: 3, accel: 3, grip: 3, drift: 3 } },
  { id: 'vector', name: 'Vector 88', blurb: 'Flat out it has no equal, but it hates a tight corner.', model: 'car', stats: { maxSpeed: 68, acceleration: 27, turnSpeed: 2.4, driftFactor: 0.27 }, bars: { speed: 5, accel: 2, grip: 2, drift: 3 } },
  { id: 'stiletto', name: 'Stiletto V12', blurb: 'Brutal off the line and quick at the top. Heavy to turn.', model: 'carStiletto', file: 'car_aventador.glb', stats: { maxSpeed: 66, acceleration: 34, turnSpeed: 2.35, driftFactor: 0.3 }, bars: { speed: 4, accel: 5, grip: 2, drift: 2 } },
  { id: 'kestrel', name: 'Kestrel', blurb: 'Light, sharp and glued to the road.', model: 'carKestrel', file: 'car_sports.glb', stats: { maxSpeed: 61.5, acceleration: 33, turnSpeed: 2.85, driftFactor: 0.17 }, bars: { speed: 2, accel: 4, grip: 5, drift: 1 } },
  { id: 'slider', name: 'Slider', blurb: 'Loose at the back. Slide it and it flies.', model: 'carSlider', file: 'car_80s.glb', stats: { maxSpeed: 63, acceleration: 29, turnSpeed: 2.75, driftFactor: 0.34 }, bars: { speed: 3, accel: 3, grip: 2, drift: 5 } },
]

export interface TrackInfo {
  id: string
  name: string
  blurb: string
  /** Where the background preview drives. */
  zone: ZoneName
  /** 0–1 through that zone. */
  at: number
  /** Tile colours. */
  tint: [string, string]
  /** A new idea, not one of the current biomes. */
  concept?: boolean
  built?: boolean
}

export const TRACKS: TrackInfo[] = [
  { id: 'bay', name: 'Cosmos Bay', blurb: 'Seafront streets and the ocean causeway.', zone: 'town', at: 0.1, tint: ['#ff9a5a', '#2a6fb0'] },
  { id: 'canyon', name: 'Red Rock Canyon', blurb: 'Sandstone walls and falling rock.', zone: 'canyon', at: 0.62, tint: ['#e8743a', '#5a2413'] },
  { id: 'dunes', name: 'Dune Sea', blurb: 'Rolling dunes, then the salt flat at full speed.', zone: 'desert', at: 0.02, tint: ['#f2bd6a', '#b5642a'] },
  { id: 'jungle', name: 'Rainforest Run', blurb: 'Waterfalls, ruins and a rope bridge.', zone: 'jungle', at: 0.08, tint: ['#57d47a', '#0c4a2c'] },
  { id: 'alpine', name: 'Alpine Pass', blurb: 'Switchbacks, ice and avalanches.', zone: 'snow', at: 0.05, tint: ['#d9ecff', '#4a6fd0'] },
  { id: 'neon', name: 'Neon City', blurb: 'Night streets and an elevated highway.', zone: 'city', at: 0.05, tint: ['#ff3fb4', '#1a0f4a'] },
  { id: 'sky', name: 'Sky Islands', blurb: 'A glass highway above the clouds.', zone: 'sky', at: 0.02, tint: ['#8fd6ff', '#f0a070'] },
  { id: 'deep', name: 'Deep Blue', blurb: 'Glass tunnels on the sea floor.', zone: 'underwater', at: 0.76, tint: ['#2fd6d0', '#063a4e'] },
  { id: 'volcano', name: 'Volcano Run', blurb: 'The ground is erupting. Keep moving.', zone: 'volcano', at: 0.02, tint: ['#ff6a1e', '#2a0a08'] },
  { id: 'moon', name: 'Lunar Plateau', blurb: 'Low gravity, long jumps, no air.', zone: 'space', at: 0.05, tint: ['#9fb4ff', '#0a0c22'] },
  { id: 'temple', name: 'Sunken Temple', blurb: 'Drowned ruins lit from below.', zone: 'underwater', at: 0.2, tint: ['#37c8a8', '#0a2e3a'], concept: true },
  { id: 'foundry', name: 'Ember Foundry', blurb: 'A lava works built inside the mountain.', zone: 'volcano', at: 0.5, tint: ['#ffb03a', '#3a1208'], concept: true },
  { id: 'glacier', name: 'Aurora Glacier', blurb: 'Blue ice under the northern lights.', zone: 'snow', at: 0.55, tint: ['#6ff0d0', '#16205a'], concept: true },
  { id: 'harbour', name: 'Storm Harbour', blurb: 'Cranes, waves and a coast in a gale.', zone: 'causeway', at: 0.05, tint: ['#7f9fc0', '#1c2c44'], concept: true },
  { id: 'caverns', name: 'Crystal Caverns', blurb: 'Glowing caves under the canyon.', zone: 'canyon', at: 0.85, tint: ['#c08aff', '#2a1050'], concept: true },
  { id: 'orbital', name: 'Orbital Ring', blurb: 'A race round the outside of a space station.', zone: 'space', at: 0.55, tint: ['#5ae0ff', '#0c1030'], concept: true },
]

/** The original full journey through every biome. */
export const GRAND_TOUR: TrackInfo = {
  id: 'tour', name: 'Grand Tour', blurb: 'The full journey: sea, moon, volcano, snow, sky and city in one lap.',
  zone: 'town', at: 0.02, tint: ['#ff3b6b', '#25d9ff'], built: true,
}

export interface CupInfo { id: string; name: string; tagline: string; color: string; races: string[] }

export const CUPS: CupInfo[] = [
  { id: 'comet', name: 'Comet Cup', tagline: 'Where every career starts.', color: '#ff7a3a', races: ['bay', 'canyon', 'dunes', 'jungle'] },
  { id: 'nova', name: 'Nova Cup', tagline: 'Faster roads, fewer second chances.', color: '#25d9ff', races: ['alpine', 'neon', 'sky', 'deep'] },
  { id: 'eclipse', name: 'Eclipse Cup', tagline: 'Fire, vacuum and the deep.', color: '#c05cff', races: ['volcano', 'moon', 'temple', 'foundry'] },
  { id: 'supernova', name: 'Supernova Cup', tagline: 'Only for the very best.', color: '#ffcf4a', races: ['glacier', 'harbour', 'caverns', 'orbital'] },
]

export const trackById = (id: string): TrackInfo => (id === GRAND_TOUR.id ? GRAND_TOUR : TRACKS.find((t) => t.id === id)!)

export type CupTrophy = 'gold' | 'silver' | 'bronze'
const TROPHY_KEY = 'nitro-cosmos-cups'
const CAR_KEY = 'nitro-cosmos-car'

export function cupTrophies(): Record<string, CupTrophy> {
  try { return JSON.parse(localStorage.getItem(TROPHY_KEY) ?? '{}') as Record<string, CupTrophy> } catch { return {} }
}

/** A cup opens once the one before it has any trophy. */
export function cupOpen(index: number): boolean {
  return index === 0 || !!cupTrophies()[CUPS[index - 1]!.id]
}

export function savedCar(): CarInfo {
  let id: string | null = null
  try { id = localStorage.getItem(CAR_KEY) } catch { /* storage blocked */ }
  return CARS.find((c) => c.id === id) ?? CARS[0]!
}
export function saveCar(id: string): void {
  try { localStorage.setItem(CAR_KEY, id) } catch { /* storage blocked */ }
}
