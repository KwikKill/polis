import ConnectButton from '@/components/connect-button'
import DecryptText from '@/components/decrypt-text'

export default function CityNotFound() {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
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
    </main>
  )
}
