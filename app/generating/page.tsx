import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import GenerateAndRedirect from '@/components/generate-and-redirect'

export const dynamic = 'force-dynamic'

export default async function GeneratingPage() {
  const session = await auth()
  if (!session?.user?.username) {
    redirect('/')
  }

  return (
    <main className="flex h-dvh items-center justify-center bg-background px-6">
      <div className="polis-hud-panel max-w-md px-8 py-6 text-center">
        <p className="polis-glow-text font-display text-lg uppercase tracking-widest">
          Building your city…
        </p>
        <p className="mt-3 text-sm text-foreground/60">
          Reading commits, stars and languages from GitHub. This can take a moment for large
          accounts.
        </p>
        <Suspense fallback={null}>
          <GenerateAndRedirect userId={session.user.id} username={session.user.username} />
        </Suspense>
      </div>
    </main>
  )
}
