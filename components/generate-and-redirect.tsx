import { redirect } from 'next/navigation'
import { generateAndSaveCity } from '@/lib/city-service'
import { prisma } from '@/lib/prisma'

// Rendered inside a <Suspense> boundary so /generating can show its shell
// immediately while the (potentially slow, many-GitHub-calls) generation
// work streams in behind it.
export default async function GenerateAndRedirect({
  userId,
  username,
}: {
  userId: string
  username: string
}) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: 'github' },
    select: { access_token: true },
  })

  await generateAndSaveCity(userId, username, account?.access_token ?? undefined)

  redirect(`/u/${username}`)
  return null
}
