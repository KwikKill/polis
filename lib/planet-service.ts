'use server'

import { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import {
  buildPlanetRoads,
  findValidPlacement,
  isValidPlacement,
  planetRadius,
  type Vec3,
} from '@/lib/planet-builder'
import { prisma } from '@/lib/prisma'
import type { CityData, PlanetCity } from '@/lib/types'

// Two users clicking "join" concurrently each read a snapshot that doesn't
// include the other's in-flight write — classic write skew across two
// separate rows, which neither Postgres's default READ COMMITTED nor
// REPEATABLE READ (snapshot isolation) actually prevents. SERIALIZABLE
// detects it and aborts one side; retry on Prisma's write-conflict code.
async function withSerializableRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034' && attempt < maxAttempts) {
        continue
      }
      throw e
    }
  }
  throw new Error('unreachable')
}

export async function getPlanetCities(): Promise<PlanetCity[]> {
  const rows = await prisma.city.findMany({ where: { planetX: { not: null } } })
  return rows.map((row) => ({
    ...(row.data as unknown as CityData),
    planetX: row.planetX!,
    planetY: row.planetY!,
    planetZ: row.planetZ!,
  }))
}

export async function getPlanetRoads(cities: PlanetCity[]) {
  const radius = planetRadius(cities.length)
  return buildPlanetRoads(
    cities.map((c) => [c.planetX, c.planetY, c.planetZ] as Vec3),
    radius,
  )
}

export async function joinPlanet(): Promise<
  { ok: true; position: Vec3 } | { ok: false; error: string }
> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: 'not signed in' }
  const userId = session.user.id

  return withSerializableRetry(async (tx) => {
    const own = await tx.city.findUnique({ where: { userId } })
    if (!own) return { ok: false, error: 'no city to add' }

    if (own.planetX !== null && own.planetY !== null && own.planetZ !== null) {
      return { ok: true, position: [own.planetX, own.planetY, own.planetZ] }
    }

    const others = await tx.city.findMany({
      where: { planetX: { not: null } },
      select: { planetX: true, planetY: true, planetZ: true },
    })
    const existing: Vec3[] = others.map((o) => [o.planetX!, o.planetY!, o.planetZ!])
    const radius = planetRadius(existing.length + 1)
    const position = findValidPlacement(existing, radius)

    await tx.city.update({
      where: { userId },
      data: { planetX: position[0], planetY: position[1], planetZ: position[2] },
    })

    return { ok: true, position }
  })
}

// Called directly from planet-scene.tsx's click handler (a Client
// Component) — the file-level 'use server' directive above makes every
// export here a proper Server Action, callable across the client/server
// boundary without a <form>. (Next requires the whole-file directive, not
// a per-function inline one, once any Client Component imports from this
// module — getPlanetCities/getPlanetRoads/joinPlanet still work exactly
// the same calling them directly from Server Components.)
export async function relocateCity(
  candidate: Vec3,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: 'not signed in' }
  const userId = session.user.id

  const len = Math.hypot(candidate[0], candidate[1], candidate[2])
  if (len < 1e-6) return { ok: false, error: 'invalid position' }
  const normalized: Vec3 = [candidate[0] / len, candidate[1] / len, candidate[2] / len]

  return withSerializableRetry(async (tx) => {
    const own = await tx.city.findUnique({ where: { userId } })
    if (!own || own.planetX === null) return { ok: false, error: 'not on the planet yet' }

    const others = await tx.city.findMany({
      where: { planetX: { not: null }, userId: { not: userId } },
      select: { planetX: true, planetY: true, planetZ: true },
    })
    const existing: Vec3[] = others.map((o) => [o.planetX!, o.planetY!, o.planetZ!])
    const radius = planetRadius(existing.length + 1)

    if (!isValidPlacement(normalized, existing, radius)) {
      return { ok: false, error: 'too close to another city' }
    }

    await tx.city.update({
      where: { userId },
      data: { planetX: normalized[0], planetY: normalized[1], planetZ: normalized[2] },
    })

    return { ok: true }
  })
}
