import { NextResponse } from 'next/server'
import { generateAndSaveCity } from '@/lib/city-service'
import { prisma } from '@/lib/prisma'

// Meant to be called from an external cron (see README) to keep published
// cities from going stale, reusing each owner's already-stored GitHub OAuth
// token — no server-side PAT needed. Pass { "username": "..." } to refresh
// a single city, or an empty body to refresh all of them.
export async function POST(request: Request) {
  const secret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!secret || secret !== process.env.REFRESH_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}) as { username?: string })

  const cities = await prisma.city.findMany({
    where: body.username ? { username: { equals: body.username, mode: 'insensitive' } } : undefined,
    include: { user: { include: { accounts: { where: { provider: 'github' } } } } },
  })

  const results = await Promise.allSettled(
    cities.map((c) =>
      generateAndSaveCity(c.userId, c.username, c.user.accounts[0]?.access_token ?? undefined),
    ),
  )

  return NextResponse.json({
    refreshed: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  })
}
