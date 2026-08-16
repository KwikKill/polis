import type { RepoData } from '@/lib/types'

const GITHUB_API = 'https://api.github.com'
const MAX_REPOS = 80
const CONCURRENCY = 6

interface GithubRepo {
  name: string
  language: string | null
  stargazers_count: number
  size: number
  created_at: string
  pushed_at: string
  fork: boolean
  archived: boolean
  html_url: string
  description: string | null
  owner: { login: string }
}

function authHeaders(token?: string): HeadersInit {
  const bearer = token ?? process.env.GITHUB_TOKEN
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  }
}

async function githubFetch<T>(path: string, token?: string): Promise<T | null> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: authHeaders(token) })
  if (!res.ok) return null
  return (await res.json()) as T
}

async function fetchAllRepos(username: string, token?: string): Promise<GithubRepo[]> {
  const repos: GithubRepo[] = []
  for (let page = 1; page <= 3; page++) {
    const batch = await githubFetch<GithubRepo[]>(
      `/users/${username}/repos?per_page=100&page=${page}&type=owner&sort=pushed`,
      token,
    )
    if (!batch || batch.length === 0) break
    repos.push(...batch)
    if (batch.length < 100) break
  }
  return repos
}

async function fetchLanguages(
  owner: string,
  repo: string,
  token?: string,
): Promise<Record<string, number>> {
  const languages = await githubFetch<Record<string, number>>(
    `/repos/${owner}/${repo}/languages`,
    token,
  )
  return languages ?? {}
}

// GitHub's /stats/commit_activity is a cached, async endpoint: on a cold
// cache (the common case, the first time anyone's queried a given repo) it
// returns 202 while it computes, which routinely takes longer than is
// reasonable to block city generation on, so callers landed on a silent 0
// far too often. Instead, ask for exactly one commit per page and read the
// total off the last page number in the pagination `Link` header, a single
// synchronous request with no warm-up, and it covers full history rather
// than just the last 52 weeks.
async function fetchCommitCount(owner: string, repo: string, token?: string): Promise<number> {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/commits?per_page=1`, {
    headers: authHeaders(token),
  })
  if (!res.ok) return 0

  const link = res.headers.get('link')
  if (!link) {
    const commits = (await res.json()) as unknown[]
    return commits.length
  }

  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>;\s*rel="last"/)
    if (match) {
      const page = new URL(match[1]).searchParams.get('page')
      return page ? parseInt(page, 10) : 1
    }
  }
  return 1
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export async function fetchGithubCity(username: string, token?: string): Promise<RepoData[]> {
  const rawRepos = await fetchAllRepos(username, token)

  const candidates = rawRepos
    .filter((r) => r.size > 0)
    .sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime())
    .slice(0, MAX_REPOS)

  return mapWithConcurrency(candidates, CONCURRENCY, async (repo) => {
    const owner = repo.owner.login
    const [languages, commits] = await Promise.all([
      fetchLanguages(owner, repo.name, token),
      fetchCommitCount(owner, repo.name, token),
    ])

    const data: RepoData = {
      name: repo.name,
      language: repo.language,
      languages,
      stars: repo.stargazers_count,
      sizeKb: repo.size,
      createdAt: repo.created_at,
      pushedAt: repo.pushed_at,
      fork: repo.fork,
      archived: repo.archived,
      commits,
      htmlUrl: repo.html_url,
      description: repo.description,
    }
    return data
  })
}
