/**
 * What the player keeps between races: finished challenges, unlocked paint and
 * a local top five for each race length. Stored in this browser only.
 */
export interface RunStats {
  laps: number
  perfectLaunch: boolean
  /** Most rings collected in a single lap, and how many a lap has. */
  rings: number
  ringsTotal: number
  hits: number
  melts: number
  saltMph: number
  fastestLapMs: number
  medal: string | null
}

export interface Challenge { id: string; label: string; done: (r: RunStats) => boolean }

export const CHALLENGES: Challenge[] = [
  { id: 'launch', label: 'Get a perfect launch', done: (r) => r.perfectLaunch },
  { id: 'rings', label: 'Every ring in one lap', done: (r) => r.ringsTotal > 0 && r.rings >= r.ringsTotal },
  { id: 'clean', label: 'Finish without a single hit', done: (r) => r.hits === 0 },
  { id: 'cool', label: 'Escape the volcano, engine intact', done: (r) => r.melts === 0 },
  { id: 'salt', label: 'Hit 190 mph on the Salt Flats', done: (r) => r.saltMph >= 190 },
  { id: 'gold', label: 'Win a gold medal', done: (r) => r.medal === 'GOLD' },
  { id: 'fast', label: 'Lap under 2:15', done: (r) => r.fastestLapMs < 135000 },
  { id: 'distance', label: 'Finish a 3-lap race', done: (r) => r.laps >= 3 },
]

export interface Paint { id: string; name: string; hex: number; unlock?: string }

export const PAINTS: Paint[] = [
  { id: 'crimson', name: 'Crimson', hex: 0xe0142a },
  { id: 'midnight', name: 'Midnight', hex: 0x18318f },
  { id: 'arctic', name: 'Arctic', hex: 0xdfe5ec },
  { id: 'toxic', name: 'Toxic', hex: 0x4fdc1e, unlock: 'cool' },
  { id: 'neon', name: 'Neon', hex: 0xff2a9d, unlock: 'rings' },
  { id: 'gold', name: 'Gold', hex: 0xd4a017, unlock: 'gold' },
]

export interface BoardEntry { ms: number; medal: string | null; paint: string; date: string }

const DONE_KEY = 'nitro-cosmos-challenges'
const PAINT_KEY = 'nitro-cosmos-paint'
const boardKey = (laps: number) => `nitro-cosmos-board-${laps}`
const BOARD_SIZE = 5

const read = <T>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback } catch { return fallback }
}
const write = (key: string, v: unknown): void => {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* storage blocked */ }
}

export const doneChallenges = (): Set<string> => new Set(read<string[]>(DONE_KEY, []))
export const paintUnlocked = (p: Paint): boolean => !p.unlock || doneChallenges().has(p.unlock)
export const savedPaint = (): Paint => {
  const id = read<string>(PAINT_KEY, 'crimson')
  const p = PAINTS.find((x) => x.id === id)
  return p && paintUnlocked(p) ? p : PAINTS[0]!
}
export const savePaint = (id: string): void => write(PAINT_KEY, id)

/** Marks off what this run achieved; returns the challenges done for the first time. */
export function scoreRun(r: RunStats): Challenge[] {
  const done = doneChallenges()
  const fresh = CHALLENGES.filter((c) => !done.has(c.id) && c.done(r))
  fresh.forEach((c) => done.add(c.id))
  write(DONE_KEY, [...done])
  return fresh
}

/** Adds the time; returns the board and this run's place in it (-1 if outside). */
export function addToBoard(laps: number, entry: BoardEntry): { board: BoardEntry[]; place: number } {
  const board = read<BoardEntry[]>(boardKey(laps), [])
  board.push(entry)
  board.sort((a, b) => a.ms - b.ms)
  const place = board.indexOf(entry)
  board.length = Math.min(board.length, BOARD_SIZE)
  write(boardKey(laps), board)
  return { board, place: place < BOARD_SIZE ? place : -1 }
}
