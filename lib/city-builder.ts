import { getLanguageColor } from '@/lib/colors'
import type { Building, CityData, District, RepoData } from '@/lib/types'

// Low-discrepancy fill *within* a district's angular wedge — the golden
// angle only gives even coverage across a full 2π circle, so a bounded
// slice needs the 1D analogue: the fractional parts of i * (golden ratio
// conjugate) fill [0, 1) evenly without periodic clumping.
const WEYL_CONJUGATE = 0.6180339887498949
const SPIRAL_SPACING = 4
const BASE_RADIUS = 1.5 // keeps even a single-repo district off the exact center
const MIN_FOOTPRINT = 1.2
const MAX_FOOTPRINT = 3.6
const MIN_HEIGHT = 1.5
const MAX_HEIGHT = 26
const STALE_DAYS = 365
const LANDMARK_COUNT = 5
const STREET_GAP = 0.8 // minimum clearance kept between building footprints
const SEPARATION_ITERATIONS = 12

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

export function buildCity(repos: RepoData[]): Pick<CityData, 'buildings' | 'districts'> {
  if (repos.length === 0) return { buildings: [], districts: [] }

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
  // dominant one reads as the most central/prominent neighborhood.
  const groups = new Map<string, RepoData[]>()
  for (const repo of repos) {
    const key = repo.language ?? 'Other'
    const list = groups.get(key)
    if (list) list.push(repo)
    else groups.set(key, [repo])
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)

  // Proportional angular width per district, floored so a language with
  // just one or two repos still reads as its own wedge instead of a sliver,
  // then renormalized back to a full circle.
  const minWidth = (Math.PI * 2) / (orderedGroups.length * 4)
  const flooredWidths = orderedGroups.map(([, group]) =>
    Math.max((group.length / repos.length) * Math.PI * 2, minWidth),
  )
  const widthSum = flooredWidths.reduce((a, b) => a + b, 0)

  const buildings: Building[] = []
  const districts: District[] = []
  let angleCursor = 0

  orderedGroups.forEach(([, group], groupIndex) => {
    const sectorWidth = (flooredWidths[groupIndex] / widthSum) * Math.PI * 2
    const startAngle = angleCursor
    const endAngle = angleCursor + sectorWidth
    angleCursor = endAngle

    districts.push({
      language: group[0].language ?? 'Other',
      color: getLanguageColor(group[0].language),
      startAngle,
      endAngle,
    })

    // Oldest first within the district: still "downtown" near its own
    // wedge's center, newest pushed toward its outer edge.
    const byAge = [...group].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )

    byAge.forEach((repo, i) => {
      const radius = BASE_RADIUS + SPIRAL_SPACING * Math.sqrt(i)
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

  return { buildings, districts }
}
