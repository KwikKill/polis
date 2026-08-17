import * as THREE from 'three'
import { curveWorldPoint } from '@/lib/sphere-curve'
import { SEA_LEVEL_HEIGHT01, terrainHeight01, terrainRadius } from '@/lib/terrain'
import type { PlanetRoad, Road } from '@/lib/types'

const UP = new THREE.Vector3(0, 1, 0)

export type Vec3 = [number, number, number]

// radius = BASE + GROWTH * sqrt(N), same "more items needs more room"
// shape already used for the single city's spiral radius. Only
// approximately tuned now that required spacing depends on each city's own
// size rather than one flat constant (see SECURITY_MARGIN below), good
// enough as a starting scale, adjust by eye if placement starts struggling
// at typical city sizes.
const PLANET_BASE_RADIUS = 120
const PLANET_GROWTH = 35
// Extra clearance beyond two cities' own touching extents, not a flat
// separation distance on its own, since a tiny and a huge city need very
// different gaps to avoid actually overlapping. Kept small on purpose:
// this is a buffer against actual overlap, not a stylistic gap, a bigger
// value reads as "placement is weirdly far from everything."
const SECURITY_MARGIN = 6
// Terrain height (see lib/terrain.ts) is roughly normalized to [-1, 1];
// reject a city candidate whose own terrain is above this so cities land
// on hills, not mountain peaks. Not 1.0 (the actual max) since that would
// only reject the single highest point.
const MAX_CITY_TERRAIN_HEIGHT_01 = 0.55
// A little above SEA_LEVEL_HEIGHT01 itself, so a city's shoreline doesn't
// sit exactly on the waterline (buildings with wet feet) — the placement-
// side analogue of SECURITY_MARGIN, a buffer rather than a bare boundary.
const COAST_CLEARANCE_HEIGHT01 = 0.04
// How many points around a candidate's own footprint get height-checked
// (see pointsOnCap below) — enough to catch a footprint that pokes into
// the ocean on one side even though its center point is dry.
const FOOTPRINT_SAMPLE_COUNT = 8
const MAX_PLACEMENT_ATTEMPTS = 500
const KNN_K = 3
const MAX_ROAD_CHORD = 260 // don't force a road to a neighbor that's still very far away
// Straight sub-segments approximating one curved connection. Was 10 back
// when the surface was a perfect sphere and this only needed to look
// smooth; now each segment's straight chord also needs to track the
// actual terrain height along the way, and 10 wide sub-segments cut
// straight through hills between their sparse sample points instead of
// following them, visible as a road clipping into the ground. Denser
// sampling keeps the chord-vs-true-terrain gap small enough not to show.
const ROAD_SEGMENTS = 24
// A small constant lift above the exact terrain radius a road segment's
// endpoints are computed at, insurance against that same chord-vs-terrain
// gap on the steepest stretches even at ROAD_SEGMENTS resolution — the
// gap is a function of terrain curvature between two adjacent sample
// points, which no fixed sample count fully eliminates.
const ROAD_SURFACE_LIFT = 0.6
const CITY_ROAD_CLEARANCE_MARGIN = 4 // beyond a city's own extent, so a road doesn't just graze its edge either
// How densely a candidate road is sampled to check whether it dips below
// sea level anywhere along its length (see crossesOcean below).
const OCEAN_CROSSING_SAMPLES = 32

export function planetRadius(cityCount: number): number {
  return PLANET_BASE_RADIUS + PLANET_GROWTH * Math.sqrt(cityCount)
}

// A city's own position + the actual reach of its buildings (city-builder
// .ts's cityExtent), placement needs the real footprint, not just a
// center point, or a big city's buildings can end up reaching into
// another city's own footprint its center point was technically clear of.
export interface PlacedCity {
  position: Vec3
  extent: number
}

// Points on the circle of `angularRadius` around `center`, via Rodrigues'
// rotation: rotate `center` toward an arbitrary tangent direction by
// angularRadius to get one boundary point, then spin that point around
// `center` itself to sweep the rest. Used to sample a candidate city's
// whole footprint (not just its own center point) against the terrain
// height field, so a city can't have its center on dry land while half its
// buildings reach out over open water.
function pointsOnCap(center: Vec3, angularRadius: number, count: number): Vec3[] {
  const c = new THREE.Vector3(center[0], center[1], center[2]).normalize()
  const arbitrary = Math.abs(c.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const tangent = new THREE.Vector3().crossVectors(arbitrary, c).normalize()
  const axis = new THREE.Vector3().crossVectors(c, tangent).normalize()
  const boundary0 = c.clone().applyAxisAngle(axis, angularRadius)

  const points: Vec3[] = []
  for (let k = 0; k < count; k++) {
    const azimuth = (k / count) * Math.PI * 2
    const p = boundary0.clone().applyAxisAngle(c, azimuth)
    points.push([p.x, p.y, p.z])
  }
  return points
}

// Marsaglia's method for a uniformly-distributed point on the unit sphere.
export function randomUnitVector(): Vec3 {
  let x1: number
  let x2: number
  let w: number
  do {
    x1 = 2 * Math.random() - 1
    x2 = 2 * Math.random() - 1
    w = x1 * x1 + x2 * x2
  } while (w >= 1)
  const factor = 2 * Math.sqrt(1 - w)
  return [x1 * factor, x2 * factor, 1 - 2 * w]
}

// Squared chord distance between two unit vectors: |a-b|^2 = 2 - 2(a.b).
// Monotonic with the angle between them, so it's safe to compare directly
// without ever computing an acos.
export function chordDistSq(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return 2 - 2 * dot
}

// A candidate is valid only if: its own terrain isn't a mountain peak or
// underwater (checked at its center *and* around its whole footprint, a
// large city's edge can dip below sea level even when its center point is
// dry), and its footprint (extent) plus a security margin clears every
// other city's *actual* footprint, not just a fixed distance between
// center points.
export function isValidPlacement(
  candidate: Vec3,
  candidateExtent: number,
  existing: PlacedCity[],
  radius: number,
): boolean {
  const centerHeight = terrainHeight01(candidate[0], candidate[1], candidate[2])
  if (centerHeight > MAX_CITY_TERRAIN_HEIGHT_01) return false
  if (centerHeight < SEA_LEVEL_HEIGHT01 + COAST_CLEARANCE_HEIGHT01) return false

  const angularExtent = 2 * Math.asin(Math.min(1, candidateExtent / (2 * radius)))
  const footprintOnLand = pointsOnCap(candidate, angularExtent, FOOTPRINT_SAMPLE_COUNT).every(
    (p) => terrainHeight01(p[0], p[1], p[2]) >= SEA_LEVEL_HEIGHT01 + COAST_CLEARANCE_HEIGHT01,
  )
  if (!footprintOnLand) return false

  return existing.every((e) => {
    const minWorldDist = candidateExtent + e.extent + SECURITY_MARGIN
    const minChordSq = (minWorldDist / radius) ** 2
    return chordDistSq(candidate, e.position) >= minChordSq
  })
}

// Bounded rejection sampling for a spot clear of every existing city's
// footprint and off the water entirely. Always returns a position, on the
// rare exhaustion of MAX_PLACEMENT_ATTEMPTS (the growth constants are
// tuned to make this vanishingly unlikely), soft-degrades to whichever
// candidate maximized the minimum distance to every neighboring city,
// rather than failing the join outright.
export function findValidPlacement(
  existing: PlacedCity[],
  candidateExtent: number,
  radius: number,
): Vec3 {
  if (existing.length === 0) return randomUnitVector()

  let best = randomUnitVector()
  let bestMinDist = -Infinity

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const candidate = randomUnitVector()
    if (isValidPlacement(candidate, candidateExtent, existing, radius)) return candidate

    const minDist = Math.min(...existing.map((e) => chordDistSq(candidate, e.position)))
    if (minDist > bestMinDist) {
      bestMinDist = minDist
      best = candidate
    }
  }

  return best
}

// Spherical linear interpolation between two unit vectors, via
// Gram-Schmidt orthonormalization rather than the more common
// sin-weighted-sum form, avoids a division-by-sin(theta) singularity when
// a and b are nearly identical.
export function slerpUnit(a: Vec3, b: Vec3, t: number): Vec3 {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  const theta = Math.acos(dot) * t

  const relX = b[0] - a[0] * dot
  const relY = b[1] - a[1] * dot
  const relZ = b[2] - a[2] * dot
  const relLen = Math.hypot(relX, relY, relZ)
  if (relLen < 1e-6) return a

  const rx = relX / relLen
  const ry = relY / relLen
  const rz = relZ / relLen
  const cosT = Math.cos(theta)
  const sinT = Math.sin(theta)

  return [a[0] * cosT + rx * sinT, a[1] * cosT + ry * sinT, a[2] * cosT + rz * sinT]
}

// What buildPlanetRoads needs from each city: its placement, its own local
// road network (so an inter-city connection can meet an actual road end
// instead of just aiming at the city's center point), and its extent (so a
// connection between two *other* cities can tell whether it would cut
// through this one's own footprint).
export interface PlanetCityRoadInfo {
  position: Vec3
  roads: Road[]
  extent: number
}

// The point where a city's own road network actually reaches furthest
// toward a neighboring city, on the true curved sphere surface, as a unit
// vector, resolves to the city's own center if it has no roads at all (e.g.
// a single-building city has none, city-builder.ts's Voronoi construction
// needs at least a couple of buildings to produce any edges).
//
// "Furthest toward" is every one of the city's road endpoints (in its own
// local x/z), scored by dot product against the neighbor's direction
// projected into this city's own tangent plane, and the highest-scoring
// endpoint wins, the same technique curvedLocalPlacement uses to find a
// prop's own corrected surface point, just applied to picking a point
// instead of placing one.
function cityEdgePoint(city: PlanetCityRoadInfo, towardPosition: Vec3, radius: number): Vec3 {
  if (city.roads.length === 0) return city.position

  const normal = new THREE.Vector3(...city.position).normalize()
  const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal)
  const selfWorld = normal.clone().multiplyScalar(radius)
  const towardWorld = new THREE.Vector3(...towardPosition).multiplyScalar(radius)
  const localDirection = towardWorld.sub(selfWorld).applyQuaternion(quaternion.clone().invert())

  let bestX = 0
  let bestZ = 0
  let bestDot = -Infinity
  for (const r of city.roads) {
    for (const [x, z] of [
      [r.x1, r.z1],
      [r.x2, r.z2],
    ]) {
      const dot = x * localDirection.x + z * localDirection.z
      if (dot > bestDot) {
        bestDot = dot
        bestX = x
        bestZ = z
      }
    }
  }

  // Normalize by the point's own actual length, not the constant radius —
  // curveWorldPoint now returns a terrain-adjusted point that generally
  // isn't exactly `radius` from center, dividing by radius would return a
  // non-unit vector.
  const worldPoint = curveWorldPoint(bestX, bestZ, normal, radius, quaternion)
  const unit = worldPoint.normalize()
  return [unit.x, unit.y, unit.z]
}

// World-unit distance from the closest point sampled along the a-b arc to
// `point`, used to test whether a straight connection would cut through a
// third city's own footprint.
function pathMinWorldDist(a: Vec3, b: Vec3, point: Vec3, radius: number, samples = ROAD_SEGMENTS): number {
  let bestDistSq = Infinity
  for (let s = 0; s <= samples; s++) {
    const d = chordDistSq(slerpUnit(a, b, s / samples), point)
    if (d < bestDistSq) bestDistSq = d
  }
  return Math.sqrt(bestDistSq) * radius
}

// Whether the straight a-b connection dips below sea level anywhere along
// its length. A continuous ocean has no single center/radius the way a
// discrete lake used to, so there's no obstacle to route an arc around —
// the road just doesn't get built at all, the same way a connection that
// would cut through a third city's footprint is dropped outright rather
// than rerouted. Real infrastructure doesn't casually bridge oceans either.
function crossesOcean(a: Vec3, b: Vec3, samples = OCEAN_CROSSING_SAMPLES): boolean {
  for (let s = 0; s <= samples; s++) {
    const p = slerpUnit(a, b, s / samples)
    if (terrainHeight01(p[0], p[1], p[2]) < SEA_LEVEL_HEIGHT01) return true
  }
  return false
}

// "Roads between nearby cities" as a K-nearest-neighbor graph (union, not
// mutual, a city connects to its K nearest, and an edge exists if either
// endpoint claims the other), not a spherical Voronoi/Delaunay diagram.
// Planet cities are sparse, unevenly-distributed points; a full spherical
// Delaunay triangulation of a sparse point set produces long edges
// reaching across empty space just to stay valid, the opposite of
// "nearby." KNN is the more literal match, and avoids depending on
// d3-geo-voronoi, which ships no TypeScript types and has no @types
// package (checked: `npm view d3-geo-voronoi types` is empty and
// `@types/d3-geo-voronoi` 404s), the exact cost d3-delaunay was already
// chosen over raw delaunator to avoid for the flat-city case.
//
// Neighbor selection itself still uses each city's *center* (that's about
// which cities count as "nearby" at all); the rendered path runs from the
// road-network edge of one city to the road-network edge of the other
// rather than center to center, so it reads as a highway continuing an
// actual street instead of a line hovering over rooftops.
//
// The two edge points are picked *asymmetrically*, not independently:
// city i's point is whichever of its own road ends reaches furthest toward
// city j's *center*, but city j's point then aims at city i's
// *already-chosen point*, not city j's center. Picking both independently
// against the two centers let them end up facing slightly different
// directions from each other's actual position, producing a visible kink
// where the straight connection met neither edge point head-on. Chaining
// the second pick off the first guarantees the two ends are at least
// mutually aimed at each other.
//
// A connection is dropped outright (not drawn at all) if the straight path
// between those two edge points would cut through a *third* city's own
// footprint (redundant anyway, that third city is presumably already
// connected to both ends via its own KNN edges) or would cross open ocean
// anywhere along its length (see crossesOcean).
export function buildPlanetRoads(cities: PlanetCityRoadInfo[], radius: number): PlanetRoad[] {
  if (cities.length < 2) return []

  const n = cities.length
  const positions = cities.map((c) => c.position)
  const neighborSets: Set<number>[] = cities.map(() => new Set())

  for (let i = 0; i < n; i++) {
    const distances = positions
      .map((pos, j) => ({ j, d: i === j ? Infinity : chordDistSq(positions[i], pos) }))
      .sort((a, b) => a.d - b.d)

    for (const { j, d } of distances.slice(0, KNN_K)) {
      if (Math.sqrt(d) * radius <= MAX_ROAD_CHORD) neighborSets[i].add(j)
    }
  }

  const roads: PlanetRoad[] = []
  const seen = new Set<string>()

  for (let i = 0; i < n; i++) {
    for (const j of neighborSets[i]) {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`
      if (seen.has(key)) continue
      seen.add(key)

      const edgeI = cityEdgePoint(cities[i], positions[j], radius)
      const edgeJ = cityEdgePoint(cities[j], edgeI, radius)

      const blockedByOtherCity = cities.some((c, k) => {
        if (k === i || k === j) return false
        const clearRadius = c.extent + CITY_ROAD_CLEARANCE_MARGIN
        return pathMinWorldDist(edgeI, edgeJ, c.position, radius) < clearRadius
      })
      if (blockedByOtherCity) continue
      if (crossesOcean(edgeI, edgeJ)) continue

      for (let s = 0; s < ROAD_SEGMENTS; s++) {
        const p0 = slerpUnit(edgeI, edgeJ, s / ROAD_SEGMENTS)
        const p1 = slerpUnit(edgeI, edgeJ, (s + 1) / ROAD_SEGMENTS)
        // Each sampled point scaled by its *own* terrain radius, not the
        // flat planet radius, so the road visibly rises and falls with
        // the ground beneath it instead of floating at a constant
        // height cutting through hills. Plus a small lift (see
        // ROAD_SURFACE_LIFT) so it stays clear of the ground even where
        // terrain curves between this sample and the next.
        const r0 = terrainRadius(p0[0], p0[1], p0[2], radius) + ROAD_SURFACE_LIFT
        const r1 = terrainRadius(p1[0], p1[1], p1[2], radius) + ROAD_SURFACE_LIFT
        roads.push({
          x1: p0[0] * r0,
          y1: p0[1] * r0,
          z1: p0[2] * r0,
          x2: p1[0] * r1,
          y2: p1[1] * r1,
          z2: p1[2] * r1,
        })
      }
    }
  }

  return roads
}
