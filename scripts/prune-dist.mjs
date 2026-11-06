// Drops assets the game never loads from the published build. public/ is untouched.
import { rmSync } from 'node:fs'
const unused = [
  'models/polyhaven/namaqualand_cliff_02', 'models/polyhaven/exterior_aircon_unit', 'models/polyhaven/wooden_barrels_01',
  'models/polyhaven/shrub_01', 'models/polyhaven/shrub_04', 'models/polyhaven/modular_fire_escape',
  'models/polyhaven/security_light', 'models/polyhaven/street_lamp_02',
  'models/nasa/dsn70.glb', 'models/nasa/shuttle.glb',
  'models/station.glb', 'models/scifi.glb', 'models/arrow.glb',
  'textures/biomes/brown_mud_leaves_01_nor.jpg', 'textures/biomes/brown_mud_leaves_01_diff.jpg',
  'textures/biomes/rock_pitted_mossy_nor.jpg', 'textures/biomes/rock_pitted_mossy_diff.jpg',
  'textures/biomes/volcanic_rock_tiles_nor.jpg', 'textures/biomes/volcanic_rock_tiles_diff.jpg',
  'textures/biomes/aerial_sand_nor.jpg', 'textures/biomes/aerial_sand_diff.jpg',
]
for (const p of unused) rmSync(`dist/${p}`, { recursive: true, force: true })
console.log(`Removed ${unused.length} unused asset paths from dist`)
