export interface RepoData {
  name: string
  language: string | null
  languages: Record<string, number> // bytes per language
  stars: number
  sizeKb: number
  createdAt: string
  pushedAt: string
  fork: boolean
  archived: boolean
  commits: number
  htmlUrl: string
  description: string | null
}

export interface Building {
  repoName: string
  description: string | null
  htmlUrl: string
  x: number
  z: number
  width: number
  depth: number
  height: number
  color: string
  intensity: number // 0..1, drives brightness/bloom
  landmark: boolean
  stale: boolean
  fork: boolean
  stars: number
  commits: number
  language: string | null
}

export interface District {
  language: string
  color: string
  startAngle: number
  endAngle: number
}

export interface CityData {
  username: string
  avatarUrl: string | null
  buildings: Building[]
  districts: District[]
  generatedAt: string
}
