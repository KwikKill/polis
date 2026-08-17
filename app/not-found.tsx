import Link from 'next/link'
import DecryptText from '@/components/decrypt-text'
import SkylineBackdrop from '@/components/skyline-backdrop'

// The site-wide fallback for any route that doesn't exist at all (e.g.
// /randombullshit) — distinct from app/u/[username]/not-found.tsx, which
// only covers a *recognized* username with no generated city. Same
// backdrop, generic copy instead of city-specific wording, since this one
// doesn't know what the visitor was even looking for.
export default function NotFound() {
  return (
    <main className="relative flex h-dvh flex-col items-center justify-center gap-4 overflow-hidden bg-background px-6 text-center">
      <SkylineBackdrop />

      <div className="relative z-10 flex flex-col items-center gap-4">
        <DecryptText
          as="p"
          text="Page not found"
          className="polis-glow-text font-display text-2xl uppercase tracking-widest"
        />
        <p className="max-w-md text-sm text-foreground/60">
          There&rsquo;s nothing at this address.
        </p>
        <Link href="/" className="polis-btn">
          Back to Polis
        </Link>
      </div>
    </main>
  )
}
