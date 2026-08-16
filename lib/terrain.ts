import { createNoise3D } from 'simplex-noise'

// Fixed, not Math.random() — every visitor sees the exact same terrain,
// same philosophy as PLANET_FEATURES' Fibonacci lattice in planet-builder.ts.
const TERRAIN_SEED = 133742

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const noise3D = createNoise3D(mulberry32(TERRAIN_SEED))

// Fewer octaves and a lower base frequency than a first pass at this
// (5 octaves, frequency 1.8) — that read as busy/chaotic rather than like
// a real planet, mostly high-frequency detail rather than a few broad,
// coherent landmasses. Fewer octaves means less fine-grained noise
// contributing at all; the lower frequency means even the dominant first
// octave spans a much bigger stretch of arc.
const OCTAVES = 3
const BASE_FREQUENCY = 1.1
const LACUNARITY = 2.0
const GAIN = 0.45

// Fraction of the *current* planet radius (see planetRadius() in
// planet-builder.ts) that terrainHeight01 is allowed to actually displace
// the surface by. Set to 0 by direct request — the planet reads as a
// sphere again — without touching anything else: terrainHeight01 itself
// keeps running exactly as before (still what picks which points become
// lakes, how big they are, and which candidates are too "high" for a
// city), only its contribution to the *radius* is zeroed out here, so
// every caller of terrainRadius() collapses to baseRadius with no other
// code needing to change. Raise this again to bring the bumps back.
export const TERRAIN_AMPLITUDE_FRACTION = 0

// 3-octave FBM sampled at a unit direction, normalized to roughly
// [-1, 1]. Frequency/lacunarity tuned so the dominant bump spans dozens
// of degrees of arc (a few broad "continents" of undulation), not
// sandpaper-fine noise — this is the single source of truth for terrain
// elevation, called from both server (placement validation, road
// generation) and client (rendering) so they can never drift apart.
export function terrainHeight01(x: number, y: number, z: number): number {
  let amplitude = 0.5
  let frequency = BASE_FREQUENCY
  let sum = 0
  let norm = 0
  for (let i = 0; i < OCTAVES; i++) {
    sum += amplitude * noise3D(x * frequency, y * frequency, z * frequency)
    norm += amplitude
    amplitude *= GAIN
    frequency *= LACUNARITY
  }
  return sum / norm
}

// The actual distance from planet center to the surface in a given unit
// direction — the replacement for "the" constant planetRadius everywhere
// a point needs to be pulled onto the true (now irregular) surface.
export function terrainRadius(
  x: number,
  y: number,
  z: number,
  baseRadius: number,
  amplitudeFraction: number = TERRAIN_AMPLITUDE_FRACTION,
): number {
  return baseRadius + terrainHeight01(x, y, z) * baseRadius * amplitudeFraction
}

// The planet surface mesh (planet-surface.tsx) sits very slightly *under*
// terrainRadius() so city ground discs (which sit at exactly
// terrainRadius(), see sphere-curve.ts) don't z-fight it.
export function groundSurfaceEpsilon(baseRadius: number): number {
  return Math.max(baseRadius * 0.002, 0.15)
}
