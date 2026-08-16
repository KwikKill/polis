import * as THREE from 'three'
import { curveWorldPoint } from '@/lib/sphere-curve'
import { terrainHeight01, terrainRadius } from '@/lib/terrain'
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
// Extra clearance beyond two cities' (or a city's and a feature's) own
// touching extents, not a flat separation distance on its own, since a
// tiny and a huge city need very different gaps to avoid actually
// overlapping. Kept small on purpose: this is a buffer against actual
// overlap, not a stylistic gap, a bigger value reads as "placement is
// weirdly far from everything."
const SECURITY_MARGIN = 6
// Terrain height (see lib/terrain.ts) is roughly normalized to [-1, 1];
// reject a city candidate whose own terrain is above this so cities land
// on hills, not mountain peaks. Not 1.0 (the actual max) since that would
// only reject the single highest point.
const MAX_CITY_TERRAIN_HEIGHT_01 = 0.55
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
const FEATURE_DETOUR_CLEARANCE_MARGIN = 6 // extra clearance beyond a feature's own radius when routing a road around it

export function planetRadius(cityCount: number): number {
  return PLANET_BASE_RADIUS + PLANET_GROWTH * Math.sqrt(cityCount)
}

// "Mountain" isn't a discrete feature anymore, it's just wherever the
// continuous terrain height field (lib/terrain.ts) happens to be high —
// every PlanetFeature left is a lake.
export interface PlanetFeature {
  position: Vec3
  // Fraction of the *current* planet radius, not an absolute world-unit
  // size, the planet grows as cities join, and a fixed-size lake would
  // shrink relative to it over time. Use featureRadius() to resolve this
  // against a specific radius.
  radiusFraction: number
}

export function featureRadius(feature: PlanetFeature, radius: number): number {
  return feature.radiusFraction * radius
}

// A city's own position + the actual reach of its buildings (city-builder
// .ts's cityExtent), placement needs the real footprint, not just a
// center point, or a big city's buildings can end up sitting in a lake
// its center point was technically clear of.
export interface PlacedCity {
  position: Vec3
  extent: number
}

// A wider candidate pool than the number of water bodies actually placed,
// so they can be *selected* by terrain height (the lowest candidates win)
// rather than just spread evenly regardless of what's underneath them.
const WATER_CANDIDATE_COUNT = 64
const WATER_COUNT = 20
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5))

// A Fibonacci lattice on the sphere, deterministic and evenly spread, no
// Math.random() anywhere in it, so every visitor sees the same candidate
// pool in exactly the same places (a fixed, shared landmark set, not decor
// that differs per page load).
function fibonacciSpherePoint(i: number, n: number): Vec3 {
  const y = 1 - (i / (n - 1)) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = GOLDEN_ANGLE_RAD * i
  return [Math.cos(theta) * r, y, Math.sin(theta) * r]
}

// Beyond a body's own edge, so two nearby ones never sit flush against
// each other, let alone overlap.
const WATER_MIN_GAP_FRACTION = 0.02

// Water pools in valleys: sample a wide, evenly-spread candidate pool,
// read the terrain height (lib/terrain.ts) at each, and keep only the
// lowest ones. Size scales with how deep the valley is *relative to the
// other selected bodies* (self-normalized against the selected set's own
// min/max), via a curve (t^WATER_SIZE_EXPONENT) rather than a straight
// line, so the very deepest handful come out ocean-scale while most stay
// modest lake-scale — an Earth-like "a few huge ones, plenty of smaller
// ones" mix rather than a smooth uniform gradient.
//
// A first pass capped everything at 10% of planet radius after measuring
// that `buildCurvedFanGeometry`'s old flat tangent-plane shoreline
// self-intersected past that size (see the removed function's git
// history) — this no longer applies: `buildSphericalCapFanGeometry`
// (sphere-curve.ts) builds shorelines from exact spherical polar
// coordinates instead of a flat projection, which stays exact at any
// size, so 62% (a genuinely ocean-scale body, confirmed clean at this
// size the same way the old 10% ceiling was confirmed broken — by direct
// measurement, not assumption) is safe.
const WATER_MIN_RADIUS_FRACTION = 0.03
const WATER_MAX_RADIUS_FRACTION = 0.62
const WATER_SIZE_EXPONENT = 2.5

export const PLANET_FEATURES: PlanetFeature[] = (() => {
  const candidates = Array.from({ length: WATER_CANDIDATE_COUNT }, (_, i) => {
    const position = fibonacciSpherePoint(i, WATER_CANDIDATE_COUNT)
    return { position, height: terrainHeight01(position[0], position[1], position[2]) }
  })
    .sort((a, b) => a.height - b.height)
    .slice(0, WATER_COUNT)

  const heights = candidates.map((c) => c.height)
  const minHeight = Math.min(...heights)
  const heightSpan = Math.max(...heights) - minHeight || 1

  const bodies = candidates.map(({ position, height }) => {
    const depthRank = 1 - (height - minHeight) / heightSpan // 1 = deepest, 0 = shallowest
    const t = Math.pow(depthRank, WATER_SIZE_EXPONENT)
    return {
      position,
      radiusFraction: WATER_MIN_RADIUS_FRACTION + (WATER_MAX_RADIUS_FRACTION - WATER_MIN_RADIUS_FRACTION) * t,
    }
  })

  // Several passes, not one: shrinking a pair to just clear each other can
  // reopen a conflict with a third body resolved in an earlier pass (a
  // cluster of 3+ close valleys), so this relaxes toward a mutually
  // clear arrangement rather than assuming a single sweep converges it.
  for (let pass = 0; pass < 4; pass++) {
    let shrunkAny = false
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const dist = Math.sqrt(chordDistSq(bodies[i].position, bodies[j].position))
        const sumRadius = bodies[i].radiusFraction + bodies[j].radiusFraction
        if (sumRadius <= 0 || dist >= sumRadius + WATER_MIN_GAP_FRACTION) continue
        // Scale both down (proportionally, so the smaller one doesn't get
        // swallowed) so their edges land exactly WATER_MIN_GAP_FRACTION
        // apart, floored so a tight 3+-way cluster can't shrink a body to
        // nothing.
        const scale = Math.max(0.25, (dist - WATER_MIN_GAP_FRACTION) / sumRadius)
        bodies[i].radiusFraction *= scale
        bodies[j].radiusFraction *= scale
        shrunkAny = true
      }
    }
    if (!shrunkAny) break
  }

  return bodies
})()

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

// A candidate is valid only if its own footprint (extent) plus a security
// margin clears every other city's *actual* footprint, and every natural
// feature's footprint, not just a fixed distance between center points,
// which let a large city's buildings reach into a lake its center was
// technically clear of.
export function isValidPlacement(
  candidate: Vec3,
  candidateExtent: number,
  existing: PlacedCity[],
  radius: number,
): boolean {
  // Terrain amplitude is a modest fraction of radius (see
  // TERRAIN_AMPLITUDE_FRACTION in lib/terrain.ts), well inside
  // SECURITY_MARGIN, so the city/lake chord-distance checks below stay a
  // fine approximation without needing to account for height directly —
  // but a city still shouldn't land *on* a mountain peak, which the old
  // discrete-mountain-feature exclusion used to prevent. Read the
  // continuous field directly instead.
  if (terrainHeight01(candidate[0], candidate[1], candidate[2]) > MAX_CITY_TERRAIN_HEIGHT_01) {
    return false
  }

  const clearOfCities = existing.every((e) => {
    const minWorldDist = candidateExtent + e.extent + SECURITY_MARGIN
    const minChordSq = (minWorldDist / radius) ** 2
    return chordDistSq(candidate, e.position) >= minChordSq
  })
  if (!clearOfCities) return false

  return PLANET_FEATURES.every((f) => {
    const minWorldDist = candidateExtent + featureRadius(f, radius) + SECURITY_MARGIN
    const featureChordSq = (minWorldDist / radius) ** 2
    return chordDistSq(candidate, f.position) >= featureChordSq
  })
}

// Bounded rejection sampling for a spot clear of every existing city's
// footprint and every natural feature. Always returns a position, on the
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

// How far along the a-b arc (0 = a, 1 = b), sampled at ROAD_SEGMENTS
// resolution, comes closest to `point` -- used both to test whether a path
// enters an obstacle's zone at all and, if so, roughly where along the
// path that happens.
function closestApproachT(a: Vec3, b: Vec3, point: Vec3, samples = ROAD_SEGMENTS): number {
  let bestT = 0
  let bestDistSq = Infinity
  for (let s = 0; s <= samples; s++) {
    const t = s / samples
    const d = chordDistSq(slerpUnit(a, b, t), point)
    if (d < bestDistSq) {
      bestDistSq = d
      bestT = t
    }
  }
  return bestT
}

// World-unit distance from the closest point sampled along the a-b arc to
// `point`, the same sampling closestApproachT does, just returning the
// distance itself rather than where it happened.
function pathMinWorldDist(a: Vec3, b: Vec3, point: Vec3, radius: number, samples = ROAD_SEGMENTS): number {
  let bestDistSq = Infinity
  for (let s = 0; s <= samples; s++) {
    const d = chordDistSq(slerpUnit(a, b, s / samples), point)
    if (d < bestDistSq) bestDistSq = d
  }
  return Math.sqrt(bestDistSq) * radius
}

// A single point pushed away from `obstaclePosition`, along the great
// circle through it and `point`, extrapolated (via slerpUnit with t > 1)
// until it's `targetWorldRadius` away. Deliberately not "push the point
// away in flat 3D space, then re-normalize back onto the sphere" (an
// earlier version did exactly that, and it doesn't actually work,
// re-normalizing after a flat push moves the point back toward/away from
// the obstacle by an amount that has nothing to do with the push
// distance, so the result routinely landed *closer* to the obstacle than
// intended). Slerp extrapolation stays exactly on the sphere throughout,
// so the angle from the obstacle is exact by construction.
//
// `desiredAngle` is derived from the target *chord* (world) distance via
// the exact `2*asin(chord / (2*radius))` relation, not a straight
// `chord/radius` division — that linear approximation is only accurate
// for small angles (fine for the original small-lake exclusion radii,
// a few percent of planet radius), and now that lakes range up to
// ocean-scale exclusion radii, the gap between the two would under-push
// roads around a big body, leaving them clipping its edge.
function pushAwayFromObstacle(
  point: Vec3,
  obstaclePosition: Vec3,
  targetWorldRadius: number,
  radius: number,
): Vec3 {
  const dot = Math.min(
    1,
    Math.max(
      -1,
      obstaclePosition[0] * point[0] + obstaclePosition[1] * point[1] + obstaclePosition[2] * point[2],
    ),
  )
  const angle = Math.acos(dot)
  if (angle < 1e-6) return point // point coincides with the obstacle's own center; nothing sane to push toward

  const desiredAngle = 2 * Math.asin(Math.min(1, targetWorldRadius / (2 * radius)))
  const t = Math.max(1, desiredAngle / angle)
  return slerpUnit(obstaclePosition, point, t)
}

// Where the straight a-b path crosses `clearWorldRadius` away from
// `obstaclePosition`, entering and exiting, found by sampling and linearly
// interpolating between the bracketing samples. Assumes (and callers
// should already have checked) that the path actually comes closer than
// clearWorldRadius somewhere in between.
function findBoundaryCrossings(
  a: Vec3,
  b: Vec3,
  obstaclePosition: Vec3,
  clearWorldRadius: number,
  radius: number,
  samples = 40,
): { entryT: number; exitT: number } {
  const distAt = (t: number) => Math.sqrt(chordDistSq(slerpUnit(a, b, t), obstaclePosition)) * radius

  let entryT = -1
  let exitT = -1
  let prevT = 0
  let prevDist = distAt(0)

  for (let s = 1; s <= samples; s++) {
    const t = s / samples
    const dist = distAt(t)

    if (entryT < 0 && prevDist >= clearWorldRadius && dist < clearWorldRadius) {
      const frac = (clearWorldRadius - prevDist) / (dist - prevDist)
      entryT = prevT + frac * (t - prevT)
    }
    if (prevDist < clearWorldRadius && dist >= clearWorldRadius) {
      const frac = (clearWorldRadius - prevDist) / (dist - prevDist)
      exitT = prevT + frac * (t - prevT)
    }

    prevT = t
    prevDist = dist
  }

  return { entryT: entryT < 0 ? 0 : entryT, exitT: exitT < 0 ? 1 : exitT }
}

// Interior waypoints spanning the exclusion zone. Each one is its own
// straight-box road segment with its own orientation (see planet-roads
// .tsx), so more of them means a smaller angular kink at every joint
// between adjacent segments, i.e. a smoother-looking curve. This mattered
// more once the rendered road width dropped to match the in-city road's
// own (narrower) width: the same kink that was easy to miss on a wide
// road reads as a visible little elbow on a narrow one.
const DETOUR_ARC_POINTS = 14
// Beyond the exact exclusion radius: a straight chord between two points
// on the same circle sags slightly *inside* that circle, so pushing points
// to exactly clearWorldRadius still let the connecting legs dip a little
// under it (verified: with no margin at all the closest approach landed
// just under the target). 1.3x comfortably absorbs that sag at
// DETOUR_ARC_POINTS's spacing without needing to solve for the exact
// chord-sag amount.
const DETOUR_CLEAR_MARGIN = 1.3

// The a-b path bent around a single obstacle, as a run of waypoints to
// splice in between a and b. Pushing only the *single* deepest point away
// from the obstacle (an earlier version of this function did exactly
// that) isn't enough on its own, since the straight legs connecting that
// one point back to a and b are then free to cut back through the
// exclusion zone on either side of it, verified: they routinely did.
// Instead, sample several points along the stretch of the *original*
// straight path that actually falls inside the exclusion zone (found via
// findBoundaryCrossings) and push each of them out individually,
// connecting the pushed points in sequence approximates an arc around the
// obstacle's boundary, since nearby points pushed onto (approximately)
// the same circle stay close to that circle's own arc when connected by
// short straight chords.
function buildFeatureDetour(
  a: Vec3,
  b: Vec3,
  obstaclePosition: Vec3,
  clearWorldRadius: number,
  radius: number,
): Vec3[] {
  const { entryT, exitT } = findBoundaryCrossings(a, b, obstaclePosition, clearWorldRadius, radius)
  if (entryT >= exitT) return []

  const targetRadius = clearWorldRadius * DETOUR_CLEAR_MARGIN
  const waypoints: Vec3[] = []
  for (let i = 0; i <= DETOUR_ARC_POINTS + 1; i++) {
    const t = entryT + (exitT - entryT) * (i / (DETOUR_ARC_POINTS + 1))
    const onPath = slerpUnit(a, b, t)
    waypoints.push(pushAwayFromObstacle(onPath, obstaclePosition, targetRadius, radius))
  }
  return waypoints
}

// Splits a straight city-edge-to-city-edge connection into waypoints that
// route around any lake whose exclusion zone the direct path would
// otherwise cut through, ordered along the path. A lake isn't a place a
// road could instead be routed *through* via a third city the way an
// intervening city is handled (see buildPlanetRoads), it just needs to be
// gone around — unlike a mountain, which isn't a discrete obstacle at
// all anymore (see lib/terrain.ts), a road just rides over one instead.
function buildRoadWaypoints(a: Vec3, b: Vec3, radius: number): Vec3[] {
  const intersecting = PLANET_FEATURES.map((f) => ({
    position: f.position,
    clearRadius: featureRadius(f, radius) + FEATURE_DETOUR_CLEARANCE_MARGIN,
  }))
    .filter((f) => pathMinWorldDist(a, b, f.position, radius) < f.clearRadius)
    .map((f) => ({ ...f, t: closestApproachT(a, b, f.position) }))
    .sort((x, y) => x.t - y.t)

  if (intersecting.length === 0) return [a, b]

  const waypoints: Vec3[] = [a]
  for (const feature of intersecting) {
    waypoints.push(...buildFeatureDetour(a, b, feature.position, feature.clearRadius, radius))
  }
  waypoints.push(b)
  return waypoints
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
// footprint, that third city is presumably already connected to both ends
// via its own KNN edges, so the direct link becomes redundant as well as
// visually wrong (a road cutting across someone else's rooftops). A lake
// in the way is handled differently, buildRoadWaypoints bends the path
// around it instead, since there's no third city to route through.
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

      const waypoints = buildRoadWaypoints(edgeI, edgeJ, radius)

      for (let leg = 0; leg < waypoints.length - 1; leg++) {
        const legA = waypoints[leg]
        const legB = waypoints[leg + 1]

        for (let s = 0; s < ROAD_SEGMENTS; s++) {
          const p0 = slerpUnit(legA, legB, s / ROAD_SEGMENTS)
          const p1 = slerpUnit(legA, legB, (s + 1) / ROAD_SEGMENTS)
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
  }

  return roads
}
