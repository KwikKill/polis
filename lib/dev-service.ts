'use server'

import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { generateAndSaveCity } from '@/lib/city-service'
import { prisma } from '@/lib/prisma'
import type { CityData } from '@/lib/types'

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
// User row for that username, generates a city for it if it doesn't have
// one yet *or* the existing one is empty (see below), then mints a
// session exactly like a real sign-in would.
//
// generateAndSaveCity works without a GitHub token, it's the exact same
// path GenerateAndRedirect calls for a normal sign-in when there's no
// linked GitHub Account token yet, but that path runs at GitHub's
// unauthenticated rate limit (60 requests/hour *per IP*, shared across
// every dev-mode sign-in), and city generation can easily be 100+ requests
// for one account (a paginated repo list, then a languages + commit-count
// call per repo). Set GITHUB_TOKEN in .env (needs no scopes, just needs to
// exist, to move the request off the unauthenticated tier and up to
// 5000/hour) to raise it for local testing. If generation fails,
// generateAndSaveCity now throws a GithubFetchError instead of silently
// saving an empty city, letting Next's dev error overlay show exactly
// why (rate limited vs. the username not existing on GitHub at all) —
// this used to fail silently, an empty city with no error at all was the
// actual bug report this was fixed for.
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
  // An empty city (zero buildings) almost always means an earlier sign-in
  // attempt hit exactly the rate-limit/error case above before this fix
  // existed, or before GITHUB_TOKEN was set, treat it the same as no city
  // at all so retrying (e.g. after setting GITHUB_TOKEN) actually retries
  // instead of forever reusing the stale empty result.
  const existingBuildingCount = existingCity
    ? (existingCity.data as unknown as CityData).buildings.length
    : 0
  if (!existingCity || existingBuildingCount === 0) {
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
