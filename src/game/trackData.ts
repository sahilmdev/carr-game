/**
 * External track data (mirrors the real game's track_data_*.json approach).
 * Every control point carries the zone label for the SPAN that starts at it —
 * samples between control point i and i+1 inherit zone[i]. This makes the
 * zone table impossible to drift out of sync with the geometry: there is no
 * separate hand-tuned fraction table anymore.
 *
 * Lap order:
 *   town → coast → causeway → underwater → rampUp → [flight1 gap] → SPACE
 *        → [flight2 gap] → canyon → volcano → desert → saltflat → snow
 *        → sky (floating islands) → [flight3 gap] → jungle → city → town
 *
 * The two `flight` zones are REAL GAPS: no road ribbon, no neon lines, no
 * boundary clamp — the car flies a scripted arc along these samples.
 */

export type ZoneName =
  | 'town'
  | 'coast'
  | 'causeway'
  | 'underwater'
  | 'rampUp'
  | 'flight1'
  | 'space'
  | 'flight2'
  | 'canyon'
  | 'loop'
  | 'volcano'
  | 'desert'
  | 'saltflat'
  | 'snow'
  | 'sky'
  | 'roll'
  | 'flight3'
  | 'jungle'
  | 'city'

export interface TrackControlPoint {
  x: number
  y: number
  z: number
  zone: ZoneName
}

const p = (x: number, y: number, z: number, zone: ZoneName): TrackControlPoint => ({ x, y, z, zone })

/** Loop geometry, shared with Track so it can build the road's banking frame. */
export interface LoopSpec {
  center: [number, number, number] // centre of the first half of the circle
  dir: [number, number]            // horizontal travel direction (unit)
  lateral: [number, number]        // sideways shift direction (unit)
  radius: number
  shift: number  // total sideways drift over all turns
  turns: number
}
export const LOOPS: LoopSpec[] = []

/**
 * Control points for a vertical loop starting at ground point (x, y, z)
 * heading along (dx, dz): 12 points per turn round the circle, drifting
 * `shift` m sideways over all `turns` (so each pass clears the last).
 * Labelled 'loop'; the point after it gets `exitZone`.
 */
function verticalLoop(x: number, y: number, z: number, dx: number, dz: number, r: number, shift: number, turns = 1, exitZone: ZoneName = 'canyon'): TrackControlPoint[] {
  const len = Math.hypot(dx, dz)
  const d: [number, number] = [dx / len, dz / len]
  const l: [number, number] = [d[1], -d[0]] // to the right of travel
  // Entry: a straight run-in of 2r, then the circle
  const ex = x + d[0] * 2 * r, ez = z + d[1] * 2 * r
  LOOPS.push({ center: [ex, y + r, ez], dir: d, lateral: l, radius: r, shift, turns })
  const pts: TrackControlPoint[] = [p(ex - d[0] * r * 0.6, y, ez - d[1] * r * 0.6, 'loop')]
  const N = 12 * turns
  for (let k = 0; k <= N; k++) {
    const th = (k / N) * Math.PI * 2 * turns
    const s = shift * (k / N)
    pts.push(p(
      ex + d[0] * r * Math.sin(th) + l[0] * s,
      y + r * (1 - Math.cos(th)),
      ez + d[1] * r * Math.sin(th) + l[1] * s,
      'loop',
    ))
  }
  pts.push(p(ex + d[0] * r * 0.6 + l[0] * shift, y, ez + d[1] * r * 0.6 + l[1] * shift, exitZone))
  return pts
}

/** Barrel roll: the deck twists a full turn round the car's own centre line. */
export interface RollSpec {
  start: [number, number, number] // road point where the twist begins
  dir: [number, number]           // horizontal travel direction (unit)
  length: number
  heart: number                   // centre-line height above the deck
}
export const ROLLS: RollSpec[] = []

/** Twist phase 0 → 2π along the roll, eased in and out. */
export function rollPhase(u: number): number {
  const t = Math.min(1, Math.max(0, u))
  return Math.PI * 2 * (t - Math.sin(Math.PI * 2 * t) / (Math.PI * 2))
}

/**
 * A heartline barrel roll along (dx, dz): the deck spirals round a straight
 * centre line `heart` metres up, so the car rolls over on the spot.
 */
function barrelRoll(x: number, y: number, z: number, dx: number, dz: number, length: number, heart: number, exitZone: ZoneName): TrackControlPoint[] {
  const len = Math.hypot(dx, dz)
  const d: [number, number] = [dx / len, dz / len]
  ROLLS.push({ start: [x, y, z], dir: d, length, heart })
  const pts: TrackControlPoint[] = []
  const N = 14
  for (let k = 0; k < N; k++) {
    const ph = rollPhase(k / N)
    // up rotated about the travel axis; the deck sits `heart` below the axis
    const ux = -d[1] * Math.sin(ph), uy = Math.cos(ph), uz = d[0] * Math.sin(ph)
    const s = (k / N) * length
    pts.push(p(x + d[0] * s - ux * heart, y + heart - uy * heart, z + d[1] * s - uz * heart, 'roll'))
  }
  pts.push(p(x + d[0] * length, y, z + d[1] * length, exitZone))
  return pts
}

export const TRACK_CONTROL_POINTS: TrackControlPoint[] = [
  // ── Town main street (start/finish gate at index 0) — gentle undulation ──
  p(0, 0, 0, 'town'),
  p(90, 1.5, -42, 'town'),
  p(185, 0, -78, 'town'),
  // ── Coast road toward the causeway — a soft crest then dip ──
  p(300, 3, -66, 'coast'),
  p(398, 0.5, -14, 'coast'),
  // ── Elevated ocean causeway ──
  p(468, 2.6, 78, 'causeway'),
  p(512, 3.2, 192, 'causeway'),
  p(500, 2.4, 308, 'causeway'),
  // ── Dive into the underwater tunnel, north under the open sea ──
  p(515, -9, 392, 'underwater'),
  p(562, -20, 478, 'underwater'),
  // ── Underwater spiral: one full descending turn (plus a quarter) — the
  //    second pass runs ~18 m beneath the first ──
  p(575, -22, 600, 'underwater'),
  p(537, -25, 665, 'underwater'),
  p(462, -28, 665, 'underwater'),
  p(425, -31, 600, 'underwater'),
  p(462, -34, 535, 'underwater'),
  p(537, -37, 535, 'underwater'),
  p(578, -40, 602, 'underwater'),
  p(545, -42, 668, 'underwater'),
  p(470, -42, 690, 'underwater'),
  // ── Long run west along the sea floor to the cove, climbing back up ──
  p(370, -38, 670, 'underwater'),
  // ── Underwater double loop-the-loop: two full vertical turns inside a
  //    glass tube, drifting 64 m sideways so each turn clears the last ──
  ...verticalLoop(370, -38, 670, -120, -60, 12, 64, 2, 'underwater'),
  p(290, -34, 690, 'underwater'),
  p(250, -30, 610, 'underwater'),
  p(130, -19, 525, 'underwater'),
  p(30, -7, 434, 'underwater'),
  // ── Launch ramp: surface and climb steeply to the lip ──
  p(-55, 6, 404, 'rampUp'),
  p(-120, 24, 382, 'rampUp'),
  // ── FLIGHT GAP 1: lip → space entry (no road built here) ──
  p(-165, 40, 362, 'flight1'),
  p(-235, 66, 326, 'flight1'),
  p(-305, 70, 298, 'flight1'),
  // ── SPACE: a long winding high-altitude moon run that banks and rolls ──
  p(-385, 62, 268, 'space'),
  p(-490, 96, 218, 'space'),
  p(-575, 70, 148, 'space'),
  p(-620, 122, 55, 'space'),
  p(-600, 84, -45, 'space'),
  p(-520, 130, -110, 'space'),
  p(-410, 78, -140, 'space'),
  p(-300, 112, -120, 'space'),
  p(-240, 80, -55, 'space'),
  p(-270, 70, 25, 'space'),
  // ── FLIGHT GAP 2: space end lip → canyon floor ──
  p(-330, 52, 70, 'flight2'),
  p(-390, 30, 60, 'flight2'),
  // ── Canyon slalom, now turning south toward the volcano ──
  p(-405, 14, 5, 'canyon'),
  p(-360, 9, -60, 'canyon'),
  p(-305, 10, -105, 'canyon'),
  // ── Vertical loop-the-loop heading south (drifts 32 m west) ──
  ...verticalLoop(-300, 10, -118, 0, -1, 15, 32),
  p(-345, 10, -210, 'canyon'),
  p(-382, 11, -262, 'canyon'),
  // ── VOLCANO: climb the flank through a cut, over the rim, round the
  //    lava lake on the crater floor, out through a lava tube ──
  p(-425, 19, -300, 'volcano'),
  p(-466, 28, -338, 'volcano'),
  p(-505, 22, -372, 'volcano'),
  p(-560, 18, -357, 'volcano'),
  p(-626, 18, -392, 'volcano'),
  p(-636, 18, -450, 'volcano'),
  p(-603, 19, -500, 'volcano'),
  p(-572, 22, -548, 'volcano'),
  p(-546, 20, -604, 'volcano'),
  // ── Out of the tube: a long downhill run round the south flank, with the
  //    lava pouring after you, ending in the jump over the lava river ──
  p(-612, 17, -640, 'volcano'),
  p(-672, 14, -694, 'volcano'),
  p(-668, 12, -748, 'volcano'),
  p(-610, 10, -752, 'volcano'),
  // ── DESERT: rolling dunes down to the salt pan ──
  p(-555, 9, -760, 'desert'),
  p(-525, 20, -800, 'desert'),
  p(-612, 8, -852, 'desert'),
  p(-700, 26, -935, 'desert'),
  p(-722, 9, -1040, 'desert'),
  p(-648, 24, -1120, 'desert'),
  p(-525, 8, -1142, 'desert'),
  p(-410, 22, -1092, 'desert'),
  p(-330, 8, -1025, 'desert'),
  p(-240, 3, -985, 'desert'),
  // ── SALT FLAT: a dead-straight top-speed run east (speed trap) ──
  p(-150, 1, -975, 'saltflat'),
  p(0, 1, -985, 'saltflat'),
  p(150, 1, -985, 'saltflat'),
  p(300, 1, -975, 'saltflat'),
  // ── SNOW: alpine pass climbing switchbacks, avalanche sheds, a frozen
  //    lake, up to the summit ──
  p(420, 2, -955, 'snow'),
  p(520, 6, -932, 'snow'),
  p(612, 13, -950, 'snow'),
  p(702, 22, -918, 'snow'),
  p(736, 30, -862, 'snow'),
  p(702, 37, -816, 'snow'),
  p(634, 44, -812, 'snow'),
  p(592, 44, -766, 'snow'),
  p(616, 44, -720, 'snow'),
  p(700, 53, -694, 'snow'),
  p(790, 58, -704, 'snow'),
  p(870, 65, -742, 'snow'),
  // ── SKY ISLANDS: a glass highway between floating islands above the
  //    clouds, with a barrel roll, ending on a launch lip ──
  p(955, 72, -772, 'sky'),
  p(1050, 78, -760, 'sky'),
  p(1112, 82, -700, 'sky'),
  p(1128, 84, -640, 'sky'),
  ...barrelRoll(1128, 84, -628, 0, 1, 120, 2.4, 'sky'),
  p(1124, 85, -470, 'sky'),
  p(1195, 104, -405, 'sky'),
  p(1280, 84, -335, 'sky'),
  p(1320, 118, -240, 'flight3'),
  p(1275, 92, -150, 'sky'),
  p(1175, 132, -110, 'flight3'),
  p(1075, 96, -140, 'sky'),
  p(1020, 118, -215, 'sky'),
  p(985, 92, -295, 'sky'),
  p(945, 85, -350, 'sky'),
  p(895, 82, -362, 'sky'),
  // ── FLIGHT GAP 3: off the last island, down through the clouds ──
  p(850, 80, -366, 'flight3'),
  p(790, 70, -376, 'flight3'),
  p(728, 48, -386, 'flight3'),
  p(676, 28, -394, 'flight3'),
  // ── JUNGLE: behind a waterfall, over a rope bridge, past ruins ──
  p(630, 18, -402, 'jungle'),
  p(576, 15, -428, 'jungle'),
  p(522, 16, -472, 'jungle'),
  p(462, 15, -470, 'jungle'),
  p(425, 13, -522, 'jungle'),
  p(418, 11, -602, 'jungle'),
  p(360, 16, -668, 'jungle'),
  p(272, 5, -680, 'jungle'),
  p(202, 18, -622, 'jungle'),
  p(212, 5, -532, 'jungle'),
  p(262, 5, -470, 'jungle'),
  p(292, 4, -415, 'jungle'),
  // ── NEON CITY: night streets, elevated highway, then a tunnel home ──
  p(282, 3, -362, 'city'),
  p(205, 15, -340, 'city'),
  p(120, 27, -318, 'city'),
  p(30, 27, -335, 'city'),
  p(-55, 14, -310, 'city'),
  p(-125, 3, -262, 'city'),
  p(-168, 2, -185, 'city'),
  p(-145, 2, -100, 'city'),
  p(-98, 1.5, -28, 'city'),
  p(-48, 0.6, 4, 'town'),
]

/** Zones the car flies through on autopilot (road gaps). */
export const FLIGHT_ZONES: ReadonlySet<ZoneName> = new Set(['flight1', 'flight2', 'flight3'])

/** Zones built on solid ground at street level (never dip under the grass). */
export const GROUND_ZONES: ReadonlySet<ZoneName> = new Set(['town', 'coast', 'canyon', 'desert', 'saltflat', 'city'])

/** Zones rendered with the space look (dark sky, stars, Earth, cyan lines). */
export const SPACE_ZONES: ReadonlySet<ZoneName> = new Set(['flight1', 'space', 'flight2'])

/** Biome landmarks shared by the track builder and the scenery. */
export const LANDMARKS = {
  volcano: { x: -560, z: -430 },
  iceLake: { x: 606, z: -768, r: 62, y: 44 },
  jungleBridge: { x: 492, z: -471, half: 34 },
}
