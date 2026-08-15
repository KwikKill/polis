import Link from 'next/link'
import { notFound } from 'next/navigation'
import CityScene from '@/components/city-scene'
import { getCity } from '@/lib/city-service'
import { OWNER_USERNAME } from '@/lib/site'

export const dynamic = 'force-dynamic'

export default async function UserCityPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const city = await getCity(username)

  if (!city) notFound()

  const isOwner = city.username.toLowerCase() === OWNER_USERNAME.toLowerCase()

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
          {!isOwner && (
            <Link href="/" className="polis-btn pointer-events-auto">
              Built with Polis
            </Link>
          )}
        </div>
      </CityScene>
    </main>
  )
}
