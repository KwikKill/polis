import { signIn } from '@/lib/auth'

export default function ConnectButton({
  callbackUrl = '/generating',
  label = 'Connect with GitHub',
}: {
  callbackUrl?: string
  label?: string
}) {
  return (
    <form
      action={async () => {
        'use server'
        await signIn('github', { redirectTo: callbackUrl })
      }}
    >
      <button type="submit" className="polis-btn">
        {label}
      </button>
    </form>
  )
}
