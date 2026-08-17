import Link from 'next/link'
import PlanetScene from '@/components/planet-scene'
import ConnectButton from '@/components/connect-button'
import DecryptText from '@/components/decrypt-text'
import DevSignInPanel from '@/components/dev-sign-in-panel'
import { auth } from '@/lib/auth'
import { planetRadius } from '@/lib/planet-builder'
import { getPlanetCities, getPlanetRoads } from '@/lib/planet-service'
import { OWNER_USERNAME } from '@/lib/site'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const [cities, session] = await Promise.all([getPlanetCities(), auth()])
  const radius = planetRadius(cities.length)
  const roads = await getPlanetRoads(cities)

  return (
    <main className="relative h-dvh w-dvw overflow-hidden">
      <PlanetScene
        cities={cities}
        radius={radius}
        roads={roads}
        viewerUsername={session?.user?.username ?? null}
      >
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 p-6 text-center">
          <div className="polis-hud-panel pointer-events-auto max-w-xl px-8 py-8">
            <p className="font-display text-xs uppercase tracking-widest text-foreground/50">
              Polis
            </p>
            <DecryptText
              as="h1"
              text="Build your city from code"
              startDelayMs={250}
              className="polis-glow-text mt-2 font-display text-3xl uppercase tracking-wide sm:text-4xl"
            />
            <p className="mt-4 text-sm text-foreground/70 sm:text-base">
              Connect your github profile and visualize every repository as a building. The number of commits is the height, the language is the color, and the stars is the lightning of the building.
              Join the planet and see how your city connects with others in a generative night-city skyline.
            </p>
            {/* Boots in after the headline above finishes decrypting (see
                .polis-boot-stagger in globals.css), a deliberate three-beat
                sequence — panel, then headline, then the actions — rather
                than everything materializing on the same frame. */}
            <div className="polis-boot-stagger mt-6 flex flex-wrap items-center justify-center gap-3">
              <ConnectButton />
              <Link href={`/u/${OWNER_USERNAME}`} className="polis-btn">
                View {OWNER_USERNAME}&rsquo;s city →
              </Link>
              <Link href="/planet" className="polis-btn">
                View planet →
              </Link>
            </div>
            {cities.length === 0 && (
              <p className="mt-4 text-xs text-foreground/40">
                (No cities have joined the planet yet.)
              </p>
            )}
            {process.env.NODE_ENV === 'development' && <DevSignInPanel />}
          </div>
        </div>
      </PlanetScene>
    </main>
  )
}
