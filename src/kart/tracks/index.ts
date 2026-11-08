import type { TrackDef } from '../types'
import { bay } from './bay'
import { jungle } from './jungle'
import { blossom } from './blossom'
import { neon } from './neon'
import { deep } from './deep'
import { goldrush } from './goldrush'
import { bobsleigh } from './bobsleigh'
import { sky } from './sky'
import { carnival } from './carnival'
import { dam } from './dam'
import { cranes } from './cranes'
import { mars } from './mars'
import { manor } from './manor'
import { galleon } from './galleon'
import { solar } from './solar'

/** Every race that can be driven, by id. */
export const RACES: Record<string, TrackDef> = { bay, jungle, blossom, neon, deep, goldrush, bobsleigh, sky, carnival, dam, cranes, mars, manor, galleon, solar }
