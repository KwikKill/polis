import Delaunator from 'delaunator'
import { getLanguageColor } from '@/lib/colors'
import type { Building, CityData, District, RepoData, Road } from '@/lib/types'

// Low-discrepancy fill *within* a district's angular wedge — the golden
// angle only gives even coverage across a full 2π circle, so a bounded
// slice needs the 1D analogue: the fractional parts of i * (golden ratio
// conjugate) fill [0, 1) evenly without periodic clumping.
const WEYL_CONJUGATE = 0.6180339887498949
const SPIRAL_SPACING = 5
const BASE_RADIUS = 1.5 // keeps even a single-repo district off the exact center
const MIN_FOOTPRINT = 1.2
const MAX_FOOTPRINT = 3.6
const MIN_HEIGHT = 1.5
const MAX_HEIGHT = 26
const STALE_DAYS = 365
const LANDMARK_COUNT = 5
const STREET_GAP = 1.1 // minimum clearance kept between building footprints
const SEPARATION_ITERATIONS = 16
const MAX_ROAD_LENGTH = 22 // drop spurious long convex-hull edges from the triangulation

function normalizedLog(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.log(value + 1) / Math.log(max + 1)
}

// The sunflower spiral only guarantees *even density*, not that two
// same-index-neighbours' footprints don't overlap — a wide building next to
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

// Delaunay triangulation of the final building centers gives exactly "which
// buildings are neighbours" — drawing its edges as streets means every road
// runs where two buildings actually sit next to each other, instead of an
// arbitrary shape overlaid on top. Each segment is trimmed inward from both
// ends so it sits in the gap between the two footprints, not through them.
function buildRoads(buildings: Building[]): Road[] {
  if (buildings.length < 3) return []

  const coords = new Float64Array(buildings.length * 2)
  buildings.forEach((b, i) => {
    coords[i * 2] = b.x
    coords[i * 2 + 1] = b.z
  })

  const delaunay = new Delaunator(coords)
  const roads: Road[] = []

  // Canonical way to walk unique undirected edges out of Delaunator's
  // half-edge structure: each edge index e pairs with halfedges[e] (its
  // twin on the neighbouring triangle, or -1 on the hull boundary); taking
  // only e > halfedges[e] visits each edge exactly once.
  for (let e = 0; e < delaunay.triangles.length; e++) {
    if (e <= delaunay.halfedges[e]) continue

    const p = delaunay.triangles[e]
    const q = delaunay.triangles[e % 3 === 2 ? e - 2 : e + 1]
    const a = buildings[p]
    const b = buildings[q]

    const dx = b.x - a.x
    const dz = b.z - a.z
    const dist = Math.hypot(dx, dz)
    if (dist < 1e-4 || dist > MAX_ROAD_LENGTH) continue

    const gap = dist - a.width / 2 - b.width / 2
    if (gap < 0.3) continue // buildings this close don't leave room for a visible street

    const nx = dx / dist
    const nz = dz / dist
    const startOffset = a.width / 2 + STREET_GAP * 0.4
    const endOffset = b.width / 2 + STREET_GAP * 0.4

    roads.push({
      x1: a.x + nx * startOffset,
      z1: a.z + nz * startOffset,
      x2: b.x - nx * endOffset,
      z2: b.z - nz * endOffset,
    })
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

  // Group into language "districts" — biggest language first, so the most
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
      const radius = BASE_RADIUS + SPIRAL_SPACING * densityFactor * Math.sqrt(i)
      const angle = startAngle + ((i * WEYL_CONJUGATE) % 1) * sectorWidth

      const footprint =
        MIN_FOOTPRINT + (MAX_FOOTPRINT - MIN_FOOTPRINT) * normalizedLog(repo.sizeKb, maxSize)
      const height =
        MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * normalizedLog(repo.commits, maxCommits)

      const landmark = landmarkNames.has(repo.name)
      const ageDays = (now - new Date(repo.pushedAt).getTime()) / 86_400_000
      const stale = ageDays > STALE_DAYS || repo.archived

      // Star-fame only — staleness is applied as a render-time dimming
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
