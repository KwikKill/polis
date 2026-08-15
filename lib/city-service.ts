import { buildCity } from '@/lib/city-builder'
import { fetchGithubCity } from '@/lib/github'
import { prisma } from '@/lib/prisma'
import type { CityData } from '@/lib/types'

export async function getCity(username: string): Promise<CityData | null> {
  const row = await prisma.city.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
  })
  if (!row) return null
  return row.data as unknown as CityData
}

// CityData deliberately doesn't carry a userId (it's the persisted render
// payload, not row metadata), so a viewer's ownership of a given city page
// needs a small separate query rather than widening that type.
export async function getViewerCityStatus(
  username: string,
  userId: string,
): Promise<{ isOwner: boolean; onPlanet: boolean }> {
  const row = await prisma.city.findFirst({
    where: { username: { equals: username, mode: 'insensitive' }, userId },
    select: { planetX: true },
  })
  return row ? { isOwner: true, onPlanet: row.planetX !== null } : { isOwner: false, onPlanet: false }
}

export async function generateAndSaveCity(
  userId: string,
  username: string,
  token?: string,
): Promise<CityData> {
  const [repos, profile] = await Promise.all([
    fetchGithubCity(username, token),
    fetch(`https://api.github.com/users/${username}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ])

  const { buildings, districts, roads } = buildCity(repos)

  const city: CityData = {
    username,
    avatarUrl: profile?.avatar_url ?? null,
    buildings,
    districts,
    roads,
    generatedAt: new Date().toISOString(),
  }

  await prisma.city.upsert({
    where: { userId },
    create: { userId, username, data: city as never },
    update: { username, data: city as never, generatedAt: new Date() },
  })

  return city
}
