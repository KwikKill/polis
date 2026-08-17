import Link from 'next/link'
import DecryptText from '@/components/decrypt-text'
import PlanetScene from '@/components/planet-scene'
import { auth } from '@/lib/auth'
import { planetRadius } from '@/lib/planet-builder'
import { getAllCitiesForDev, getPlanetCities, getPlanetRoads } from '@/lib/planet-service'

export const dynamic = 'force-dynamic'

const isDev = process.env.NODE_ENV === 'development'

export default async function PlanetPage() {
  const [cities, session, devCities] = await Promise.all([
    getPlanetCities(),
    auth(),
    isDev ? getAllCitiesForDev() : Promise.resolve(undefined),
  ])
  const radius = planetRadius(cities.length)
  const roads = await getPlanetRoads(cities)

  return (
    <main className="h-dvh w-dvw overflow-hidden">
      <PlanetScene
        cities={cities}
        radius={radius}
        roads={roads}
        viewerUsername={session?.user?.username ?? null}
        devMode={isDev}
        devCities={devCities}
      >
        <div className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-start justify-between p-6">
          <div className="polis-hud-panel pointer-events-auto px-4 py-3">
            <p className="font-display text-xs uppercase tracking-widest text-foreground/60">
              Polis
            </p>
            <DecryptText
              as="p"
              text="The planet"
              startDelayMs={250}
              className="polis-glow-text font-display text-lg"
            />
            <DecryptText
              as="p"
              text={`${cities.length} ${cities.length === 1 ? 'city' : 'cities'}`}
              startDelayMs={650}
              className="text-xs text-data"
            />
          </div>
          <Link href="/" className="polis-btn pointer-events-auto">
            Menu
          </Link>
        </div>
      </PlanetScene>
    </main>
  )
}
