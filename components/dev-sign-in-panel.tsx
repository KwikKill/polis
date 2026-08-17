import { devListUsernames, devSignIn } from '@/lib/dev-service'

// Local-only escape hatch around the real GitHub OAuth flow: sign in as
// any username by typing it (generates a city for it via the same
// unauthenticated-fallback path GenerateAndRedirect already uses when
// there's no linked GitHub token) or picking one that's already been
// generated. Only ever rendered by callers that already checked
// NODE_ENV === 'development' themselves; devListUsernames/devSignIn also
// re-check and throw/no-op otherwise, so this can't do anything in prod
// even if somehow reached.
export default async function DevSignInPanel() {
  const usernames = await devListUsernames()

  return (
    <div className="polis-hud-panel pointer-events-auto mt-4 px-4 py-3 text-left">
      <p className="font-display text-xs uppercase tracking-widest text-accent">
        Dev mode — local sign-in
      </p>
      <form
        action={async (formData: FormData) => {
          'use server'
          await devSignIn(String(formData.get('username') ?? ''))
        }}
        className="mt-2 flex gap-2"
      >
        <input
          name="username"
          placeholder="github username"
          required
          className="min-w-0 flex-1 border border-line bg-background/80 px-2 py-1 text-sm text-foreground placeholder:text-foreground/40 focus:border-primary focus:outline-none"
        />
        <button type="submit" className="polis-btn">
          Sign in
        </button>
      </form>

      {usernames.length > 0 && (
        <form
          action={async (formData: FormData) => {
            'use server'
            await devSignIn(String(formData.get('username') ?? ''))
          }}
          className="mt-2 flex gap-2"
        >
          <select
            name="username"
            className="min-w-0 flex-1 border border-line bg-background/80 px-2 py-1 text-sm text-foreground focus:border-primary focus:outline-none"
          >
            {usernames.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <button type="submit" className="polis-btn">
            Switch to
          </button>
        </form>
      )}
    </div>
  )
}
