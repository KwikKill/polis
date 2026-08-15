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

// A street segment along the boundary of two buildings' Voronoi cells —
// the actual gap between them, not a line connecting their centers.
export interface Road {
  x1: number
  z1: number
  x2: number
  z2: number
}

export interface CityData {
  username: string
  avatarUrl: string | null
  buildings: Building[]
  districts: District[]
  roads: Road[]
  generatedAt: string
}

// A city that has joined the shared planet — its own rendering data plus
// where it sits on the planet's surface, stored as a unit vector.
export interface PlanetCity extends CityData {
  planetX: number
  planetY: number
  planetZ: number
}

// One short segment of a curved road between two nearby planet cities,
// sampled along a great-circle-ish arc — several of these approximate one
// full connection.
export interface PlanetRoad {
  x1: number
  y1: number
  z1: number
  x2: number
  y2: number
  z2: number
}
