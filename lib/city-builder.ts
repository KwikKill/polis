import { Delaunay } from 'd3-delaunay'
import { getLanguageColor } from '@/lib/colors'
import type { Building, CityData, District, RepoData, Road } from '@/lib/types'

// Low-discrepancy fill *within* a district's angular wedge, the golden
// angle only gives even coverage across a full 2π circle, so a bounded
// slice needs the 1D analogue: the fractional parts of i * (golden ratio
// conjugate) fill [0, 1) evenly without periodic clumping.
const WEYL_CONJUGATE = 0.6180339887498949
const SPIRAL_SPACING = 4.3
// r = c*i^RADIAL_EXPONENT instead of the classic c*sqrt(i): an exponent
// below 0.5 makes the curve steeper near i=0 (more room right around
// downtown) and flatter for large i (rings pulled closer together further
// out), redistributing density toward the center per user preference.
const RADIAL_EXPONENT = 0.4
const BASE_RADIUS = 2.2 // keeps even a single-repo district off the exact center
const MIN_FOOTPRINT = 1.2
const MAX_FOOTPRINT = 3.6
const MIN_HEIGHT = 1.5
const MAX_HEIGHT = 26
const STALE_DAYS = 365
const LANDMARK_COUNT = 5
const STREET_GAP = 0.9 // minimum clearance kept between building footprints
const SEPARATION_ITERATIONS = 16
const ROAD_BOUNDS_PADDING = 7 // how far past the outermost building the Voronoi diagram gets clipped

function normalizedLog(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.log(value + 1) / Math.log(max + 1)
}

// How far this city's own buildings actually reach from its local origin,
// the real footprint size, used wherever something needs to know "how much
// room does this city need" (the planet's ground-disc sizing, and its
// placement collision checks) rather than a one-size-fits-all constant.
export function cityExtent(buildings: Building[]): number {
  return Math.max(...buildings.map((b) => Math.hypot(b.x, b.z) + b.width / 2), 10)
}

// A flavor stat, not a real metric — "population" for a place that's
// literally just repositories is inherently make-believe, so this leans
// into the size the buildings already carry rather than inventing a
// separate model: total built volume (width * depth * height, already a
// function of repo size and commit count via buildWidth/buildHeight
// above) times a density constant picked purely so the result reads like
// a plausible city population, not to mean anything more precise than
// that.
const POPULATION_DENSITY = 90

export function estimatePopulation(buildings: Building[]): number {
  const totalVolume = buildings.reduce((sum, b) => sum + b.width * b.depth * b.height, 0)
  return Math.round(totalVolume * POPULATION_DENSITY)
}

// The sunflower spiral only guarantees *even density*, not that two
// same-index-neighbours' footprints don't overlap, a wide building next to
// another wide one can still collide. Relax the layout with a few passes of
// simple circle-based separation, nudging overlapping pairs apart. Cheap
// enough to run as plain O(n²) for city-sized counts (<=MAX_REPOS repos).
// Doesn't care how positions were seeded, so it works the same whether
// buildings came from one global spiral or several per-district wedges.
function resolveOverlaps(buildings: Building[]): void {
  for (let iter = 0; iter < SEPARATION_ITERATIONS; iter++) {
    let moved = false
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i]
        const b = buildings[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const dist = Math.hypot(dx, dz)
        const minDist = (a.width + b.width) / 2 + STREET_GAP
        if (dist < minDist) {
          moved = true
          const overlap = minDist - dist
          const nx = dist > 1e-4 ? dx / dist : 1
          const nz = dist > 1e-4 ? dz / dist : 0
          a.x -= (nx * overlap) / 2
          a.z -= (nz * overlap) / 2
          b.x += (nx * overlap) / 2
          b.z += (nz * overlap) / 2
        }
      }
    }
    if (!moved) break
  }
}

function edgeKey(x1: number, z1: number, x2: number, z2: number): string {
  const round = (n: number) => Math.round(n * 100)
  const a = `${round(x1)}_${round(z1)}`
  const b = `${round(x2)}_${round(z2)}`
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function onBoundsRect(
  x: number,
  z: number,
  bounds: [number, number, number, number],
  eps = 0.05,
): boolean {
  return (
    Math.abs(x - bounds[0]) < eps ||
    Math.abs(x - bounds[2]) < eps ||
    Math.abs(z - bounds[1]) < eps ||
    Math.abs(z - bounds[3]) < eps
  )
}

// The Voronoi diagram is the dual of the Delaunay triangulation: its edges
// are exactly the lines equidistant between neighbouring buildings, i.e.
// the actual gaps between them, rather than lines connecting building
// centers through the buildings themselves. Each building's Voronoi cell
// is effectively its own plot; the network of cell boundaries reads as a
// street grid the buildings sit *beside*, not a web radiating out of them.
function buildRoads(buildings: Building[]): Road[] {
  if (buildings.length < 3) return []

  const points: Array<[number, number]> = buildings.map((b) => [b.x, b.z])
  const delaunay = Delaunay.from(points)

  const xs = buildings.map((b) => b.x)
  const zs = buildings.map((b) => b.z)
  const bounds: [number, number, number, number] = [
    Math.min(...xs) - ROAD_BOUNDS_PADDING,
    Math.min(...zs) - ROAD_BOUNDS_PADDING,
    Math.max(...xs) + ROAD_BOUNDS_PADDING,
    Math.max(...zs) + ROAD_BOUNDS_PADDING,
  ]
  const voronoi = delaunay.voronoi(bounds)

  const seen = new Set<string>()
  const roads: Road[] = []

  for (let i = 0; i < buildings.length; i++) {
    const cell = voronoi.cellPolygon(i)
    if (!cell) continue

    for (let k = 0; k < cell.length; k++) {
      const [x1, z1] = cell[k]
      const [x2, z2] = cell[(k + 1) % cell.length]

      // Skip the outer frame introduced by clipping unbounded cells to
      // `bounds`, it's not a real street, just where the diagram was cut.
      if (onBoundsRect(x1, z1, bounds) && onBoundsRect(x2, z2, bounds)) continue

      const key = edgeKey(x1, z1, x2, z2)
      if (seen.has(key)) continue
      seen.add(key)

      roads.push({ x1, z1, x2, z2 })
    }
  }

  return roads
}

export function buildCity(repos: RepoData[]): Pick<CityData, 'buildings' | 'districts' | 'roads'> {
  if (repos.length === 0) return { buildings: [], districts: [], roads: [] }

  const maxCommits = Math.max(...repos.map((r) => r.commits), 1)
  const maxSize = Math.max(...repos.map((r) => r.sizeKb), 1)
  const maxStars = Math.max(...repos.map((r) => r.stars), 1)

  const landmarkNames = new Set(
    [...repos]
      .sort((a, b) => b.stars - a.stars)
      .slice(0, LANDMARK_COUNT)
      .filter((r) => r.stars > 0)
      .map((r) => r.name),
  )

  const now = Date.now()

  // Group into language "districts", biggest language first, so the most
  // dominant one reads as the most central/prominent neighborhood. Sector
  // width is a direct, unpadded proportion of that language's share of the
  // account's repos: 50% C / 50% JS renders as an exact half-and-half split,
  // not adjusted toward any fixed/minimum size.
  const groups = new Map<string, RepoData[]>()
  for (const repo of repos) {
    const key = repo.language ?? 'Other'
    const list = groups.get(key)
    if (list) list.push(repo)
    else groups.set(key, [repo])
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)

  const buildings: Building[] = []
  const districts: District[] = []
  let angleCursor = 0

  orderedGroups.forEach(([, group]) => {
    const sectorWidth = (group.length / repos.length) * Math.PI * 2
    const startAngle = angleCursor
    angleCursor += sectorWidth

    districts.push({
      language: group[0].language ?? 'Other',
      color: getLanguageColor(group[0].language),
      startAngle,
      endAngle: angleCursor,
    })

    // A sunflower spiral's r = c*sqrt(i) growth assumes a full 2π of room
    // to spread into at each radius; confined to a narrower wedge, the same
    // formula packs points into proportionally less arc length and they
    // end up cramped. Scaling the radial growth by sqrt(2π / sectorWidth)
    // keeps roughly the same point *density* regardless of wedge width
    // (capped so a near-empty wedge doesn't fling its one building away).
    const densityFactor = Math.min(3, Math.sqrt((Math.PI * 2) / sectorWidth))

    // Oldest first within the district: still "downtown" near its own
    // wedge's center, newest pushed toward its outer edge.
    const byAge = [...group].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )

    byAge.forEach((repo, i) => {
      const radius = BASE_RADIUS + SPIRAL_SPACING * densityFactor * Math.pow(i, RADIAL_EXPONENT)
      const angle = startAngle + ((i * WEYL_CONJUGATE) % 1) * sectorWidth

      const footprint =
        MIN_FOOTPRINT + (MAX_FOOTPRINT - MIN_FOOTPRINT) * normalizedLog(repo.sizeKb, maxSize)
      const height =
        MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * normalizedLog(repo.commits, maxCommits)

      const landmark = landmarkNames.has(repo.name)
      const ageDays = (now - new Date(repo.pushedAt).getTime()) / 86_400_000
      const stale = ageDays > STALE_DAYS || repo.archived

      // Star-fame only, staleness is applied as a render-time dimming
      // multiplier (see building-field.tsx) rather than baked in here, so a
      // stale-but-once-popular repo still reads as a big, dark, dead
      // building rather than shrinking its glow to nothing.
      let intensity = 0.15 + 0.85 * normalizedLog(repo.stars, maxStars)
      if (landmark) intensity = Math.max(intensity, 0.85)

      buildings.push({
        repoName: repo.name,
        description: repo.description,
        htmlUrl: repo.htmlUrl,
        x: radius * Math.cos(angle),
        z: radius * Math.sin(angle),
        width: footprint,
        depth: footprint,
        height,
        color: getLanguageColor(repo.language),
        intensity,
        landmark,
        stale,
        fork: repo.fork,
        stars: repo.stars,
        commits: repo.commits,
        language: repo.language,
      } satisfies Building)
    })
  })

  resolveOverlaps(buildings)
  const roads = buildRoads(buildings)

  return { buildings, districts, roads }
}
