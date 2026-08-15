import Link from 'next/link'
import CityScene from '@/components/city-scene'
import ConnectButton from '@/components/connect-button'
import { getCity } from '@/lib/city-service'
import { OWNER_USERNAME } from '@/lib/site'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const city = await getCity(OWNER_USERNAME)

  return (
    <main className="relative h-dvh w-dvw overflow-hidden">
      {city ? <CityScene city={city} /> : <div className="absolute inset-0 bg-background" />}

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-6 p-6 text-center">
        <div className="polis-hud-panel pointer-events-auto max-w-xl px-8 py-8">
          <p className="font-display text-xs uppercase tracking-widest text-foreground/50">
            Polis
          </p>
          <h1 className="polis-glow-text mt-2 font-display text-3xl uppercase tracking-wide sm:text-4xl">
            A city built from code
          </h1>
          <p className="mt-4 text-sm text-foreground/70 sm:text-base">
            Every repository is a building. Commits is height, language is color, stars are enlightenment. 
            The skyline above is {OWNER_USERNAME}&rsquo;s GitHub, connect your own to build yours.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <ConnectButton />
            <Link href={`/u/${OWNER_USERNAME}`} className="polis-btn">
              View {OWNER_USERNAME}&rsquo;s city →
            </Link>
            <Link href="/planet" className="polis-btn">
              View planet →
            </Link>
          </div>
          {!city && (
            <p className="mt-4 text-xs text-foreground/40">
              (The showcase city hasn&rsquo;t been generated yet.)
            </p>
          )}
        </div>
      </div>
    </main>
  )
}
