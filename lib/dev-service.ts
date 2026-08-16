'use server'

import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { generateAndSaveCity } from '@/lib/city-service'
import { prisma } from '@/lib/prisma'

// @auth/core's own cookie name for a database-strategy session, unprefixed
// unless the deployment is HTTPS (see @auth/core/lib/utils/cookie.js's
// defaultCookies: `${useSecureCookies ? '__Secure-' : ''}authjs.session-token`).
// Dev mode is gated to NODE_ENV=development, which in this project always
// means a plain http://localhost dev server, so the unprefixed name is
// always the right one here, no need to actually inspect the request.
const SESSION_COOKIE_NAME = 'authjs.session-token'
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30 // 30 days

function assertDevMode() {
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('Dev tools are only available with NODE_ENV=development')
  }
}

// Mints a real database Session row and sets the exact cookie a genuine
// GitHub sign-in would, bypassing the OAuth round-trip entirely, so
// everything downstream (auth(), ownership checks, joinPlanet/relocateCity)
// reads it exactly the same way regardless of which path created it.
async function establishDevSession(userId: string) {
  const sessionToken = crypto.randomUUID()
  const expires = new Date(Date.now() + SESSION_MAX_AGE_MS)
  await prisma.session.create({ data: { sessionToken, userId, expires } })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires,
  })
}

// Signs in as `username` with no GitHub OAuth at all: reuses (or creates) a
// User row for that username, generates a city for it if one doesn't exist
// yet (generateAndSaveCity already works without a GitHub token, just at
// the public, unauthenticated rate limit, since it's the exact same path
// GenerateAndRedirect calls for a normal sign-in when there's no linked
// GitHub Account token yet), then mints a session exactly like a real
// sign-in would.
export async function devSignIn(username: string) {
  assertDevMode()
  const trimmed = username.trim()
  if (!trimmed) return

  const user = await prisma.user.upsert({
    where: { username: trimmed },
    update: {},
    create: { username: trimmed, name: trimmed },
  })

  const existingCity = await prisma.city.findUnique({ where: { userId: user.id } })
  if (!existingCity) {
    await generateAndSaveCity(user.id, trimmed)
  }

  await establishDevSession(user.id)
  redirect(`/u/${trimmed}`)
}

// Every username that already has a generated city, for a quick-pick list
// instead of always typing one out fresh.
export async function devListUsernames(): Promise<string[]> {
  assertDevMode()
  const rows = await prisma.city.findMany({
    select: { username: true },
    orderBy: { username: 'asc' },
  })
  return rows.map((r) => r.username)
}
