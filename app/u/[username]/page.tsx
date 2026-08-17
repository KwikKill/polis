import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import AddToPlanetButton from '@/components/add-to-planet-button'
import CityScene from '@/components/city-scene'
import DecryptText from '@/components/decrypt-text'
import { auth } from '@/lib/auth'
import { getCity, getViewerCityStatus } from '@/lib/city-service'
import { OWNER_USERNAME } from '@/lib/site'

export const dynamic = 'force-dynamic'

// The image itself comes from the sibling opengraph-image.tsx route (Next
// wires it in automatically); this is just the title/description text
// that goes alongside it, per-user instead of the root layout's one
// static site-wide pair.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const city = await getCity(username)
  if (!city) {
    return { title: 'City not found - Polis' }
  }
  return {
    title: `${city.username}’s city - Polis`,
    description: `${city.buildings.length} repositories generated into a night-city skyline on Polis: height from commits, color from language, light from stars.`,
  }
}

export default async function UserCityPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const [city, session] = await Promise.all([getCity(username), auth()])

  if (!city) notFound()

  // Two different things: is this the SITE owner's (KwikKill's) city, vs.
  // does the CURRENT logged-in visitor own this specific city page.
  const isSiteOwner = city.username.toLowerCase() === OWNER_USERNAME.toLowerCase()
  const viewerStatus = session?.user?.id
    ? await getViewerCityStatus(username, session.user.id)
    : null
  const isViewerOwner = viewerStatus?.isOwner ?? false
  const onPlanet = viewerStatus?.onPlanet ?? false

  return (
    <main className="h-dvh w-dvw overflow-hidden">
      <CityScene city={city}>
        <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-start justify-between p-6">
          <div className="polis-hud-panel pointer-events-auto px-4 py-3">
            <p className="font-display text-xs uppercase tracking-widest text-foreground/60">
              Polis
            </p>
            <DecryptText
              as="p"
              text={`${city.username}’s city`}
              className="polis-glow-text font-display text-lg"
            />
            <a
              href={`https://github.com/${city.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              github.com/{city.username}
            </a>
          </div>
          <Link href="/" className="polis-btn pointer-events-auto">
            {isSiteOwner ? 'Menu' : 'Built with Polis'}
          </Link>
        </div>

        {isViewerOwner && (
          <div className="pointer-events-none fixed inset-x-0 bottom-16 z-10 flex justify-center">
            <div className="pointer-events-auto">
              {onPlanet ? (
                <Link href="/planet" className="polis-btn">
                  View on planet →
                </Link>
              ) : (
                <AddToPlanetButton />
              )}
            </div>
          </div>
        )}
      </CityScene>
    </main>
  )
}
