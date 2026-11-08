import type { CarConfig } from './Car'

/**
 * Everything the lobby offers: cars, tracks and cups. Tracks not marked built
 * appear in the menus but can't be raced yet.
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
  { id: 'stiletto', name: 'Stiletto V12', blurb: 'The fastest car here, and brutal off the line. Heavy to turn.', model: 'carStiletto', file: 'car_aventador.glb', stats: { maxSpeed: 69, acceleration: 34, turnSpeed: 2.35, driftFactor: 0.3 }, bars: { speed: 5, accel: 5, grip: 2, drift: 2 } },
  { id: 'aurora', name: 'Aurora', blurb: 'Glued to the road, sharp into every bend.', model: 'carAurora', file: 'car_concept.glb', hq: true, stats: { maxSpeed: 62.5, acceleration: 32, turnSpeed: 2.85, driftFactor: 0.17 }, bars: { speed: 2, accel: 4, grip: 5, drift: 1 } },
  { id: 'vector', name: 'Vector 88', blurb: 'Loose at the back. Slide it and it flies.', model: 'car', stats: { maxSpeed: 65, acceleration: 28, turnSpeed: 2.75, driftFactor: 0.34 }, bars: { speed: 4, accel: 2, grip: 2, drift: 5 } },
]

export interface TrackInfo {
  id: string
  name: string
  blurb: string
  /** Tile colours. */
  tint: [string, string]
  /** Can be raced now. */
  built?: boolean
}

export const TRACKS: TrackInfo[] = [
  { id: 'bay', name: 'Cosmos Bay', blurb: 'From the seafront up onto a viaduct high over open water.', tint: ['#ff9a5a', '#2a6fb0'], built: true },
  { id: 'jungle', name: 'Rainforest Run', blurb: 'Behind the falls, over the rope bridge. The rain turns it to mud.', tint: ['#57d47a', '#0c4a2c'], built: true },
  { id: 'blossom', name: 'Blossom Pass', blurb: 'Red gates, cherry trees and long drifts over a mountain at dusk.', tint: ['#ff8ab4', '#6a2a54'], built: true },
  { id: 'neon', name: 'Neon City', blurb: 'Wet streets and an expressway. The last lap goes dark.', tint: ['#ff3fb4', '#1a0f4a'], built: true },
  { id: 'deep', name: 'Deep Blue', blurb: 'A glass tunnel through coral, wrecks and something huge. The power is failing.', tint: ['#2fd6d0', '#063a4e'], built: true },
  { id: 'goldrush', name: 'Gold Rush Line', blurb: 'Boomtown, trestle and mine. The train crosses the road, and it will not stop.', tint: ['#e8a03a', '#5a2413'], built: true },
  { id: 'bobsleigh', name: 'Bobsleigh Peak', blurb: 'Banked ice, a leap over the ravine, and the cog railway back up.', tint: ['#d9ecff', '#4a6fd0'], built: true },
  { id: 'sky', name: 'Sky Islands', blurb: 'A glass highway above the clouds, and leaps across open air.', tint: ['#8fd6ff', '#f0a070'], built: true },
  { id: 'carnival', name: 'Midnight Carnival', blurb: 'The road is the rollercoaster.', tint: ['#ffd24a', '#40106a'], built: true },
  { id: 'dam', name: 'The Great Dam', blurb: 'The gates open and the river comes for the road.', tint: ['#7fb0c8', '#1c3444'], built: true },
  { id: 'cranes', name: 'Skyline Cranes', blurb: 'Scaffolding, swinging beams and rooftop jumps.', tint: ['#ffb03a', '#2a3448'], built: true },
  { id: 'mars', name: 'Mars Colony', blurb: 'Red dust, glass domes and long, floaty jumps.', tint: ['#ff7a4a', '#5a1c10'], built: true },
  { id: 'manor', name: 'Hollow Manor', blurb: 'Through the rooms and out of the roof.', tint: ['#8a7ad0', '#1c1630'], built: true },
  { id: 'galleon', name: 'Ghost Galleon Bay', blurb: 'A midnight race through the decks of sunken ships.', tint: ['#4ad0b0', '#0c2030'], built: true },
  { id: 'solar', name: 'Solar Crown', blurb: 'A gold road skimming the surface of a star.', tint: ['#ffcf4a', '#a02a08'], built: true },
]

/** The original full journey through every biome. */
export const GRAND_TOUR: TrackInfo = {
  id: 'tour', name: 'Grand Tour', blurb: 'The full journey: sea, moon, volcano, snow, sky and city in one lap.', tint: ['#ff3b6b', '#25d9ff'], built: true,
}

export interface CupInfo { id: string; name: string; tagline: string; color: string; races: string[] }

export const CUPS: CupInfo[] = [
  { id: 'comet', name: 'Comet Cup', tagline: 'Places you know, pushed further. Learn to drift, cut and recover.', color: '#ff7a3a', races: ['bay', 'jungle', 'blossom', 'neon'] },
  { id: 'nova', name: 'Nova Cup', tagline: 'The road stops being a road: trains, ice and tunnels.', color: '#25d9ff', races: ['deep', 'goldrush', 'bobsleigh', 'sky'] },
  { id: 'eclipse', name: 'Eclipse Cup', tagline: 'Built by people, and falling apart around you.', color: '#c05cff', races: ['carnival', 'dam', 'cranes', 'mars'] },
  { id: 'supernova', name: 'Supernova Cup', tagline: 'Haunted, sunken and burning, then the whole journey.', color: '#ffcf4a', races: ['manor', 'galleon', 'solar', 'tour'] },
]

export const trackById = (id: string): TrackInfo => (id === GRAND_TOUR.id ? GRAND_TOUR : TRACKS.find((t) => t.id === id)!)

export type CupTrophy = 'gold' | 'silver' | 'bronze'
const TROPHY_KEY = 'nitro-cosmos-cups'
const CAR_KEY = 'nitro-cosmos-car'

export function cupTrophies(): Record<string, CupTrophy> {
  try { return JSON.parse(localStorage.getItem(TROPHY_KEY) ?? '{}') as Record<string, CupTrophy> } catch { return {} }
}

export function saveTrophy(cup: string, trophy: CupTrophy): void {
  const all = cupTrophies()
  const rank = { bronze: 1, silver: 2, gold: 3 }
  if (all[cup] && rank[all[cup]!] >= rank[trophy]) return
  all[cup] = trophy
  try { localStorage.setItem(TROPHY_KEY, JSON.stringify(all)) } catch { /* storage blocked */ }
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
