// Drops assets the game never loads from the published build. public/ is untouched.
import { rmSync } from 'node:fs'
const unused = [
  'models/polyhaven/namaqualand_cliff_02', 'models/polyhaven/exterior_aircon_unit',
  'models/polyhaven/shrub_01', 'models/polyhaven/modular_fire_escape',
  'models/polyhaven/security_light', 'models/polyhaven/street_lamp_02',
  'models/nasa/dsn70.glb', 'models/nasa/shuttle.glb', 'models/car_80s.glb', 'models/car_sports.glb',
  'models/station.glb', 'models/scifi.glb', 'models/arrow.glb',
]
for (const p of unused) rmSync(`dist/${p}`, { recursive: true, force: true })
console.log(`Removed ${unused.length} unused asset paths from dist`)
