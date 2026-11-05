import * as THREE from 'three'
import { LANDMARKS } from '../trackData'
import type { BuildCtx } from './types'
import { props, at, type PropName } from './Props'
import { rng, scatter, zoneIndices, rightAt, smooth } from './kit'
import type { ZoneName } from '../Track'

/**
 * Real scanned props for the southern biomes (Poly Haven, CC0). Scanned
 * models come in real-world metres, so scales are honest except where a
 * small scanned stone is used as a boulder.
 */
/** Half-width of each scanned model at scale 1 (m). */
const PROP_RADIUS: Partial<Record<PropName, number>> = {
  rock_face_01: 2.5, rock_face_02: 1.4, boulder_01: 0.9, dead_tree_trunk: 1.6, dead_tree_trunk_02: 2.1, quiver_tree_01: 0.6, quiver_tree_02: 0.45,
  othonna_cerarioides: 0.6, cheiridopsis_succulent: 0.3, wild_rooibos_bush: 0.4, namaqualand_boulder_02: 1.25, namaqualand_boulder_05: 0.7,
  namaqualand_boulders_01: 0.3, namaqualand_cliff_01: 4.2, rock_moss_set_01: 1.7, rock_moss_set_02: 1.3, stone_01: 0.06, tree_stump_01: 0.8,
  pachira_aquatica_01: 2.2, fern_02: 0.5, calathea_orbifolia_01: 0.3, shrub_02: 1.15, mountainside: 5.1, rock_07: 0.15, rock_09: 0.07, root_cluster_01: 2,
}

export function placeBiomeProps(ctx: BuildCtx, groups: Record<string, THREE.Group>): void {
  const rand = rng(2024)
  const t = ctx.terrain
  const ground = (x: number, z: number) => t.heightAt(x, z)
  const normal = (x: number, z: number) => t.normalAt(x, z)
  const ids = (...z: ZoneName[]) => zoneIndices(ctx.track, ...z)

  /** Scatter `n` copies of a prop; scale range [s0, s1], sunk `sink` × scale. */
  const put = (name: PropName, group: THREE.Group, spots: [number, number, number][], s0: number, s1: number, o: { sink?: number; tint?: THREE.Color; tilt?: number } = {}) => {
    const mats = spots.flatMap(([x, y, z]) => {
      const s = s0 + rand() * (s1 - s0)
      // the model's own width counts: its edge must clear the road
      const r = PROP_RADIUS[name]
      if (r !== undefined && ctx.road.near(x, z, ctx.track.width / 2 + 2.5 + r * s)) return []
      // on a slope the downhill side would float: sink by how steep it is
      const onTerrain = Math.abs(y - t.heightAt(x, z)) < 0.6
      const slope = onTerrain ? 1 - t.normalAt(x, z).y : 0
      const extra = slope * 2.2 * Math.min(s, 4)
      return [at(x, y - (o.sink ?? 0.05) * s - extra, z, rand() * Math.PI * 2, s, (o.tilt ?? 0) * rand(), rand() * 6.3)]
    })
    props.place(name, mats, group, { tint: o.tint })
  }
  const base = { ground, normal, clear: ctx.track.width / 2 + 3 }

  // ── Volcano: dark basalt outcrops, scattered bombs of rock, charred trunks ──
  {
    const g = groups['volcano']!
    const v = ids('volcano')
    const basalt = new THREE.Color(0.32, 0.3, 0.29)
    const V = LANDMARKS.volcano
    const notLake = (x: number, z: number) => Math.hypot(x - V.x, z - V.z) < 62
    put('rock_face_01', g, scatter(ctx.track, v, ctx.road, 46, rand, { ...base, minOff: 16, maxOff: 150, maxSlope: 0.7, reject: notLake }), 1.2, 3.2, { tint: basalt, sink: 0.12 })
    put('rock_face_02', g, scatter(ctx.track, v, ctx.road, 46, rand, { ...base, minOff: 14, maxOff: 120, maxSlope: 0.7, reject: notLake }), 1.4, 3.5, { tint: basalt, sink: 0.1 })
    put('boulder_01', g, scatter(ctx.track, v, ctx.road, 70, rand, { ...base, minOff: 13, maxOff: 90, reject: notLake }), 0.8, 2.6, { tint: basalt, sink: 0.15 })
    const charred = new THREE.Color(0.22, 0.2, 0.19)
    put('dead_tree_trunk', g, scatter(ctx.track, v, ctx.road, 26, rand, { ...base, minOff: 16, maxOff: 120, maxSlope: 0.4 }), 1, 1.6, { tint: charred, sink: 0.08 })
    put('dead_tree_trunk_02', g, scatter(ctx.track, v, ctx.road, 26, rand, { ...base, minOff: 16, maxOff: 120, maxSlope: 0.4 }), 0.9, 1.5, { tint: charred, sink: 0.2 })
  }

  // ── Desert: quiver trees, succulents, granite boulders, roadside junk ──
  {
    const g = groups['desert']!
    const d = ids('desert')
    const s = ids('saltflat')
    put('quiver_tree_01', g, scatter(ctx.track, d, ctx.road, 34, rand, { ...base, minOff: 15, maxOff: 120, maxSlope: 0.35 }), 1.6, 2.8)
    put('quiver_tree_02', g, scatter(ctx.track, d, ctx.road, 30, rand, { ...base, minOff: 14, maxOff: 100, maxSlope: 0.35 }), 1.8, 3)
    put('dead_quiver_trunk', g, scatter(ctx.track, d, ctx.road, 18, rand, { ...base, minOff: 14, maxOff: 90 }), 1.5, 2.6, { tilt: 0.25 })
    put('othonna_cerarioides', g, scatter(ctx.track, d, ctx.road, 30, rand, { ...base, minOff: 13, maxOff: 70 }), 0.9, 1.6)
    put('cheiridopsis_succulent', g, scatter(ctx.track, d, ctx.road, 40, rand, { ...base, minOff: 12, maxOff: 50 }), 1, 2.2)
    put('wild_rooibos_bush', g, scatter(ctx.track, d, ctx.road, 90, rand, { ...base, minOff: 12, maxOff: 80 }), 1.1, 2.4)
    put('namaqualand_boulder_02', g, scatter(ctx.track, d, ctx.road, 32, rand, { ...base, minOff: 16, maxOff: 140 }), 1.5, 4.5, { sink: 0.15 })
    put('namaqualand_boulder_05', g, scatter(ctx.track, d, ctx.road, 32, rand, { ...base, minOff: 14, maxOff: 110 }), 1.5, 4, { sink: 0.15 })
    put('namaqualand_boulders_01', g, scatter(ctx.track, [...d, ...s.slice(0, 30)], ctx.road, 40, rand, { ...base, minOff: 13, maxOff: 60 }), 4, 9)
    put('namaqualand_cliff_01', g, scatter(ctx.track, d, ctx.road, 18, rand, { ...base, minOff: 40, maxOff: 170 }), 1.8, 3.6, { sink: 0.1 })
    // junk dumped along the verge
    const verge = { ...base, minOff: 11.5, maxOff: 16, jitter: 4 }
    put('old_tyre', g, scatter(ctx.track, d, ctx.road, 14, rand, verge), 1, 1, { tilt: 1.4, sink: 0.25 })
    put('rusted_wheel_rim_01', g, scatter(ctx.track, d, ctx.road, 10, rand, verge), 1, 1, { tilt: 1.5, sink: 0.2 })
    put('barrel_03', g, scatter(ctx.track, d, ctx.road, 12, rand, verge), 1, 1.1)
    put('metal_jerrycan', g, scatter(ctx.track, d, ctx.road, 10, rand, verge), 1, 1)
  }

  // ── Alpine pass: snow-dusted boulders, stumps, fallen logs ──
  {
    const g = groups['snow']!
    const sn = ids('snow')
    const lake = LANDMARKS.iceLake
    const offLake = (x: number, z: number) => Math.hypot(x - lake.x, z - lake.z) < lake.r + 10
    const frosty = new THREE.Color(0.86, 0.9, 1.0)
    put('rock_moss_set_01', g, scatter(ctx.track, sn, ctx.road, 50, rand, { ...base, minOff: 13, maxOff: 120, reject: offLake }), 1.2, 3, { tint: frosty, sink: -0.2 })
    put('rock_moss_set_02', g, scatter(ctx.track, sn, ctx.road, 50, rand, { ...base, minOff: 13, maxOff: 120, reject: offLake }), 1.2, 3, { tint: frosty, sink: -0.2 })
    put('stone_01', g, scatter(ctx.track, sn, ctx.road, 60, rand, { ...base, minOff: 13, maxOff: 90, reject: offLake }), 18, 45, { tint: frosty })
    put('tree_stump_01', g, scatter(ctx.track, sn, ctx.road, 40, rand, { ...base, minOff: 13, maxOff: 70, maxSlope: 0.5, reject: offLake }), 0.9, 1.5, { sink: 0.1 })
    put('dead_tree_trunk', g, scatter(ctx.track, sn, ctx.road, 24, rand, { ...base, minOff: 14, maxOff: 80, maxSlope: 0.4, reject: offLake }), 1.1, 1.8, { sink: 0.06 })
  }

  // ── Rainforest: real tropical plants, ferns, mossy rock walls, logs ──
  {
    const g = groups['jungle']!
    const j = ids('jungle')
    const dry = (_x: number, _z: number, y: number) => y < 3
    const opt = { ...base, reject: dry }
    put('pachira_aquatica_01', g, scatter(ctx.track, j, ctx.road, 70, rand, { ...opt, minOff: 12, maxOff: 60 }), 1.6, 3)
    put('fern_02', g, scatter(ctx.track, j, ctx.road, 170, rand, { ...opt, minOff: 11.5, maxOff: 45, jitter: 6 }), 1.6, 3.2)
    put('calathea_orbifolia_01', g, scatter(ctx.track, j, ctx.road, 120, rand, { ...opt, minOff: 11.5, maxOff: 35, jitter: 6 }), 2, 3.6)
    put('shrub_02', g, scatter(ctx.track, j, ctx.road, 110, rand, { ...opt, minOff: 12, maxOff: 60 }), 1, 1.8, { sink: 0.12 })
    put('mountainside', g, scatter(ctx.track, j, ctx.road, 14, rand, { ...opt, minOff: 26, maxOff: 90, maxSlope: 0.6 }), 1.2, 2.2, { sink: 0.1, tint: new THREE.Color(0.8, 0.9, 0.75) })
    const moss = new THREE.Color(0.55, 0.75, 0.45)
    put('rock_07', g, scatter(ctx.track, j, ctx.road, 50, rand, { ...opt, minOff: 12, maxOff: 50 }), 8, 18, { tint: moss })
    put('rock_09', g, scatter(ctx.track, j, ctx.road, 50, rand, { ...opt, minOff: 12, maxOff: 50 }), 14, 30, { tint: moss })
    put('dead_tree_trunk_02', g, scatter(ctx.track, j, ctx.road, 20, rand, { ...opt, minOff: 13, maxOff: 50, maxSlope: 0.4 }), 1, 1.6, { sink: 0.2, tint: new THREE.Color(0.75, 0.85, 0.65) })
    put('root_cluster_01', g, scatter(ctx.track, j, ctx.road, 12, rand, { ...opt, minOff: 14, maxOff: 40 }), 1, 1.6)
  }

  // ── City: street furniture along the ground-level streets ──
  {
    const g = groups['city']!
    const c = ids('city').filter((i) => ctx.track.samples[i]!.y < 3.5 && ctx.track.samples[i]!.x > -95)
    const flat = () => 0.03
    const kerb = { clear: ctx.track.width / 2 + 0.8, ground: flat, minOff: 11.6, maxOff: 13, jitter: 6 }
    put('fire_hydrant', g, scatter(ctx.track, c, ctx.road, 14, rand, kerb), 1, 1)
    put('utility_box_01', g, scatter(ctx.track, c, ctx.road, 10, rand, { ...kerb, minOff: 13, maxOff: 15 }), 1, 1)
    put('utility_box_02', g, scatter(ctx.track, c, ctx.road, 10, rand, { ...kerb, minOff: 13, maxOff: 15 }), 1, 1)
    put('metal_trash_can', g, scatter(ctx.track, c, ctx.road, 16, rand, kerb), 1, 1)
    put('concrete_road_barrier', g, scatter(ctx.track, c, ctx.road, 18, rand, { ...kerb, minOff: 11.2, maxOff: 11.6 }), 1.2, 1.2)
    // under the elevated highway: rows of barriers, bins and utility cabinets
    const raised = ids('city').filter((i) => ctx.track.samples[i]!.y > 6)
    const under: [number, number, number][] = []
    for (let k = 0; k < raised.length; k += 18) {
      const i = raised[k]!
      const p = ctx.track.samples[i]!, r = rightAt(ctx.track, i)
      for (const s of [-1, 1]) under.push([p.x + r.x * s * 6, 0.03, p.z + r.z * s * 6])
    }
    put('concrete_road_barrier', g, under, 1.3, 1.3)
    put('water_manhole_cover', g, scatter(ctx.track, c, ctx.road, 20, rand, { ...kerb, clear: 0, minOff: 2, maxOff: 9 }).map(([x, , z]) => [x, 0.06, z] as [number, number, number]), 1.4, 1.4, { sink: 0 })
  }

  // ── Sky islands: shrubs and mossy rocks on the island tops ──
  {
    const g = groups['sky']!
    const spots = (g.userData['islandTops'] as [number, number, number, number][] | undefined) ?? []
    const shrubs: [number, number, number][] = [], rocks: [number, number, number][] = []
    for (const [cx, cy, cz, R] of spots) {
      for (let k = 0; k < Math.round(R * 0.5); k++) {
        const a = rand() * 6.3, rr = Math.sqrt(rand()) * R * 0.85
        const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr
        if (ctx.road.near(x, z, ctx.track.width / 2 + 2, cy, 8)) continue
        ;(rand() < 0.6 ? shrubs : rocks).push([x, cy, z])
      }
    }
    put('shrub_02', g, shrubs, 0.9, 1.6, { sink: 0.1 })
    put('rock_moss_set_02', g, rocks, 1, 2, { sink: -0.3 })
  }
  void smooth
}
