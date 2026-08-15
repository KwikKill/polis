import type { PlanetRoad } from '@/lib/types'

export type Vec3 = [number, number, number]

// radius = BASE + GROWTH * sqrt(N) — same "more items needs more room"
// shape already used for the single city's spiral radius. Constants target
// roughly 25% areal packing so rejection sampling in findValidPlacement
// stays fast: each city "owns" a disc of radius MIN_SEPARATION_ARC/2, area
// ~= pi*35^2 ~= 3848; solving N*3848 / (4*pi*R^2) = 0.25 for R gives
// R ~= 35*sqrt(N), i.e. PLANET_GROWTH ~= MIN_SEPARATION_ARC / 2. Starting
// values to tune by eye, same spirit as city-builder.ts's own constants.
const PLANET_BASE_RADIUS = 120
const PLANET_GROWTH = 35
const MIN_SEPARATION_ARC = 70 // world-unit distance kept clear between any two cities
const MAX_PLACEMENT_ATTEMPTS = 500
const KNN_K = 3
const MAX_ROAD_CHORD = 260 // don't force a road to a neighbor that's still very far away
const ROAD_SEGMENTS = 10 // straight sub-segments approximating one curved connection

export function planetRadius(cityCount: number): number {
  return PLANET_BASE_RADIUS + PLANET_GROWTH * Math.sqrt(cityCount)
}

export interface PlanetFeature {
  kind: 'lake' | 'mountain'
  position: Vec3
  radius: number // world units, converted to unit-sphere chord distance the same way MIN_SEPARATION_ARC is
}

const FEATURE_COUNT = 14
const GOLDEN_ANGLE_RAD = Math.PI * (3 - Math.sqrt(5))

// A Fibonacci lattice on the sphere — deterministic and evenly spread, no
// Math.random() anywhere in it, so every visitor sees lakes and mountains
// in exactly the same places (a fixed, shared landmark set, not decor that
// differs per page load).
function fibonacciSpherePoint(i: number, n: number): Vec3 {
  const y = 1 - (i / (n - 1)) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const theta = GOLDEN_ANGLE_RAD * i
  return [Math.cos(theta) * r, y, Math.sin(theta) * r]
}

export const PLANET_FEATURES: PlanetFeature[] = Array.from({ length: FEATURE_COUNT }, (_, i) => ({
  kind: i % 2 === 0 ? 'lake' : 'mountain',
  position: fibonacciSpherePoint(i, FEATURE_COUNT),
  radius: 14 + (i % 3) * 4, // 14 / 18 / 22, some size variety
}))

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

export function isValidPlacement(candidate: Vec3, existing: Vec3[], radius: number): boolean {
  const minChordSq = (MIN_SEPARATION_ARC / radius) ** 2
  const clearOfCities = existing.every((e) => chordDistSq(candidate, e) >= minChordSq)
  if (!clearOfCities) return false

  return PLANET_FEATURES.every((f) => {
    const featureChordSq = (f.radius / radius) ** 2
    return chordDistSq(candidate, f.position) >= featureChordSq
  })
}

// Bounded rejection sampling for a spot at least MIN_SEPARATION_ARC world
// units from every existing city. Always returns a position — on the rare
// exhaustion of MAX_PLACEMENT_ATTEMPTS (the growth constants are tuned to
// make this vanishingly unlikely), soft-degrades to whichever candidate
// maximized the minimum distance to every neighbor, rather than failing
// the join outright.
export function findValidPlacement(existing: Vec3[], radius: number): Vec3 {
  if (existing.length === 0) return randomUnitVector()

  let best = randomUnitVector()
  let bestMinDist = -Infinity

  for (let attempt = 0; attempt < MAX_PLACEMENT_ATTEMPTS; attempt++) {
    const candidate = randomUnitVector()
    if (isValidPlacement(candidate, existing, radius)) return candidate

    const minDist = Math.min(...existing.map((e) => chordDistSq(candidate, e)))
    if (minDist > bestMinDist) {
      bestMinDist = minDist
      best = candidate
    }
  }

  return best
}

// Spherical linear interpolation between two unit vectors, via
// Gram-Schmidt orthonormalization rather than the more common
// sin-weighted-sum form — avoids a division-by-sin(theta) singularity when
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

// "Roads between nearby cities" as a K-nearest-neighbor graph (union, not
// mutual — a city connects to its K nearest, and an edge exists if either
// endpoint claims the other), not a spherical Voronoi/Delaunay diagram.
// Planet cities are sparse, unevenly-distributed points; a full spherical
// Delaunay triangulation of a sparse point set produces long edges
// reaching across empty space just to stay valid — the opposite of
// "nearby." KNN is the more literal match, and avoids depending on
// d3-geo-voronoi, which ships no TypeScript types and has no @types
// package (checked: `npm view d3-geo-voronoi types` is empty and
// `@types/d3-geo-voronoi` 404s) — the exact cost d3-delaunay was already
// chosen over raw delaunator to avoid for the flat-city case.
export function buildPlanetRoads(cities: Vec3[], radius: number): PlanetRoad[] {
  if (cities.length < 2) return []

  const n = cities.length
  const neighborSets: Set<number>[] = cities.map(() => new Set())

  for (let i = 0; i < n; i++) {
    const distances = cities
      .map((pos, j) => ({ j, d: i === j ? Infinity : chordDistSq(cities[i], pos) }))
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

      for (let s = 0; s < ROAD_SEGMENTS; s++) {
        const p0 = slerpUnit(cities[i], cities[j], s / ROAD_SEGMENTS)
        const p1 = slerpUnit(cities[i], cities[j], (s + 1) / ROAD_SEGMENTS)
        roads.push({
          x1: p0[0] * radius,
          y1: p0[1] * radius,
          z1: p0[2] * radius,
          x2: p1[0] * radius,
          y2: p1[1] * radius,
          z2: p1[2] * radius,
        })
      }
    }
  }

  return roads
}
