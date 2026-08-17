import ConnectButton from '@/components/connect-button'
import DecryptText from '@/components/decrypt-text'
import SkylineBackdrop from '@/components/skyline-backdrop'

// Every other route in this app renders inside a full 3D scene; this is
// the one exception, since there's no city to actually show. A dimmed,
// motionless skyline silhouette plus a faint grid keeps the same "you're
// still inside Polis" feeling instead of the app suddenly reading as a
// plain error page that escaped it.
export default function CityNotFound() {
  return (
    <main className="relative flex h-dvh flex-col items-center justify-center gap-4 overflow-hidden bg-background px-6 text-center">
      <SkylineBackdrop />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <DecryptText
          as="p"
          text="This city hasn't been built yet"
          className="polis-glow-text font-display text-2xl uppercase tracking-widest"
        />
        <p className="max-w-md text-sm text-foreground/60">
          No one has connected this GitHub account to Polis yet. Connect your own account to
          generate your city.
        </p>
        <ConnectButton />
      </div>
    </main>
  )
}
