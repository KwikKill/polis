import Link from 'next/link'
import { notFound } from 'next/navigation'
import AddToPlanetButton from '@/components/add-to-planet-button'
import CityScene from '@/components/city-scene'
import { auth } from '@/lib/auth'
import { getCity, getViewerCityStatus } from '@/lib/city-service'
import { OWNER_USERNAME } from '@/lib/site'

export const dynamic = 'force-dynamic'

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
            <p className="polis-glow-text font-display text-lg">{city.username}&rsquo;s city</p>
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
