import { PrismaClient } from '@prisma/client'
import { buildCity } from '../lib/city-builder'
import type { RepoData } from '../lib/types'

const LANGS = ['TypeScript', 'Python', 'Vue', 'C#', 'Java', 'C++', 'C', 'JavaScript', null]

function randomRepo(i: number): RepoData {
  const createdAt = new Date(Date.now() - Math.random() * 5 * 365 * 86_400_000)
  const pushedAt = new Date(
    createdAt.getTime() + Math.random() * (Date.now() - createdAt.getTime()),
  )
  return {
    name: `repo-${i}`,
    language: LANGS[Math.floor(Math.random() * LANGS.length)],
    languages: {},
    stars: Math.random() < 0.1 ? Math.floor(Math.random() * 200) : Math.floor(Math.random() * 5),
    sizeKb: Math.floor(Math.random() * 500_000) + 1,
    createdAt: createdAt.toISOString(),
    pushedAt: pushedAt.toISOString(),
    fork: Math.random() < 0.15,
    archived: Math.random() < 0.05,
    commits: Math.floor(Math.random() * 3000),
    htmlUrl: `https://github.com/test/repo-${i}`,
    description: null,
  }
}

async function main() {
  const prisma = new PrismaClient()
  const repos = Array.from({ length: 60 }, (_, i) => randomRepo(i))
  const buildings = buildCity(repos)

  const user = await prisma.user.upsert({
    where: { username: 'testuser' },
    create: { username: 'testuser', name: 'Test User' },
    update: {},
  })

  await prisma.city.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      username: 'testuser',
      data: {
        username: 'testuser',
        avatarUrl: null,
        buildings,
        generatedAt: new Date().toISOString(),
      } as never,
    },
    update: {},
  })

  console.log(`seeded testuser with ${buildings.length} buildings`)
  await prisma.$disconnect()
}

main()
