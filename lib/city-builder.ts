import { getLanguageColor } from '@/lib/colors'
import type { Building, RepoData } from '@/lib/types'

const GOLDEN_ANGLE = 2.399963229728653 // radians, Vogel's sunflower spiral
const SPIRAL_SPACING = 3.2
const MIN_FOOTPRINT = 1.2
const MAX_FOOTPRINT = 4
const MIN_HEIGHT = 1.5
const MAX_HEIGHT = 26
const STALE_DAYS = 365
const LANDMARK_COUNT = 5

function normalizedLog(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.log(value + 1) / Math.log(max + 1)
}

export function buildCity(repos: RepoData[]): Building[] {
  if (repos.length === 0) return []

  // Oldest first: the sunflower spiral's early indices sit near the center,
  // so a repo's age directly determines its distance from downtown.
  const byAge = [...repos].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )

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

  return byAge.map((repo, i) => {
    const radius = SPIRAL_SPACING * Math.sqrt(i)
    const angle = i * GOLDEN_ANGLE

    const footprint =
      MIN_FOOTPRINT + (MAX_FOOTPRINT - MIN_FOOTPRINT) * normalizedLog(repo.sizeKb, maxSize)
    const height =
      MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * normalizedLog(repo.commits, maxCommits)

    const landmark = landmarkNames.has(repo.name)
    const ageDays = (now - new Date(repo.pushedAt).getTime()) / 86_400_000
    const stale = ageDays > STALE_DAYS || repo.archived

    let intensity = 0.15 + 0.85 * normalizedLog(repo.stars, maxStars)
    if (landmark) intensity = Math.max(intensity, 0.85)
    if (stale) intensity *= 0.3

    return {
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
    } satisfies Building
  })
}
