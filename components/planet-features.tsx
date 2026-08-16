'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { PLANET_FEATURES, featureRadius, type PlanetFeature } from '@/lib/planet-builder'
import { buildSphericalCapFanGeometry } from '@/lib/sphere-curve'
import { terrainRadius } from '@/lib/terrain'

// A violet in the site's own palette family (--secondary is #8a2be2),
// brightened for visibility against the dark ground — replaces the
// original cyan, which read wrong against this magenta/violet scheme.
const WATER_COLOR = '#9d4dff'
// Bumped up from the original 40 — bodies now range up to ocean scale, a
// coastline that size needs more points to still read as smoothly
// irregular rather than faceted.
const SHORELINE_SEGMENTS = 56
// A deliberate lift above the ground mesh's own surface radius, well
// beyond the small epsilon inset planet-surface.tsx already uses to keep
// city ground discs from z-fighting it. That epsilon alone (a few tenths
// of a unit) turned out not to be enough here: a large water body's fill
// (unlike its wireframe, confirmed identical either way) rendered as a
// hollow ring instead of a solid disc, city-scale small lakes never
// showed it. Confirmed directly, not assumed: forcing a much bigger gap
// made the fill render correctly solid, so this is genuine z-fighting
// against the ground mesh whose visibility scales with triangle/screen
// size, not a triangulation defect.
const WATER_SURFACE_LIFT = 8

// An organic shoreline, not a perfect circle, three gentle sine harmonics
// perturbing the *angular* radius at each azimuth (a third, finer one
// layered on top of the original two for more irregular shorelines),
// seeded by the feature's own index (not Math.random()) so the shape is
// exactly as fixed/shared as its position. Kept deliberately mild:
// stacking more/higher-frequency harmonics at real amplitude looks like a
// spiky pinwheel once triangulated as a fan from the center, not an
// organic shoreline, a shoreline should wander, not slam between
// near-zero and 1.4x every couple samples.
function angularWobble(azimuth: number, seed: number): number {
  return (
    1 +
    0.22 * Math.sin(azimuth * 3 + seed * 1.7) +
    0.12 * Math.sin(azimuth * 5 - seed * 2.2) +
    0.07 * Math.sin(azimuth * 9 + seed * 4.1)
  )
}

// Rendered flat, at one fixed elevation (the body's own basin radius,
// i.e. the terrain height at its center direction), rather than draped
// per-vertex over the surrounding terrain noise like everything else —
// real water pools level, it doesn't follow every wrinkle of the lake
// bed. Built from true spherical polar coordinates around the body's
// center (see buildSphericalCapFanGeometry), not a flat tangent-plane
// projection — needed once bodies range up to ocean scale, a flat
// projection distorts badly enough at that size to self-intersect
// (measured directly: forcing every body to a small fixed size made the
// artifact disappear, restoring real size reproduced it identically,
// regardless of triangulation order — the projection itself was the
// problem, not the triangulation).
function WaterBody({ feature, radius, seed }: { feature: PlanetFeature; radius: number; seed: number }) {
  const normal = useMemo(
    () => new THREE.Vector3(feature.position[0], feature.position[1], feature.position[2]).normalize(),
    [feature],
  )
  const surfaceRadius = useMemo(
    () => terrainRadius(normal.x, normal.y, normal.z, radius),
    [normal, radius],
  )
  // The exact angular radius a flat world-unit clearance (featureRadius,
  // also what isValidPlacement/road-detour exclusion zones use) sweeps
  // out at this body's own surface radius — 2*asin(chord/(2R)), not a
  // linear chord/R division, so the rendered shoreline lines up exactly
  // with where placement logic actually excludes cities and routes roads.
  const baseAngularRadius = useMemo(() => {
    const worldRadius = featureRadius(feature, radius)
    return 2 * Math.asin(Math.min(1, worldRadius / (2 * surfaceRadius)))
  }, [feature, radius, surfaceRadius])

  const geometry = useMemo(
    () =>
      buildSphericalCapFanGeometry(
        normal,
        (azimuth) => baseAngularRadius * angularWobble(azimuth, seed),
        SHORELINE_SEGMENTS,
        surfaceRadius + WATER_SURFACE_LIFT,
      ),
    [normal, baseAngularRadius, seed, surfaceRadius],
  )

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={WATER_COLOR}
        toneMapped={false}
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Fixed natural landmarks, same set, same positions, for every visitor
// (see PLANET_FEATURES) — water bodies only now, mountains aren't a
// discrete object anymore, "mountain" is just wherever the continuous
// terrain height field (lib/terrain.ts, applied to the planet surface
// mesh and every curved-surface consumer via sphere-curve.ts) happens to
// be high. Water bodies still carve out exclusion zones in
// isValidPlacement, so a city can never actually land in one.
export default function PlanetFeatures({ radius }: { radius: number }) {
  return (
    <>
      {PLANET_FEATURES.map((f, i) => (
        <WaterBody key={i} feature={f} radius={radius} seed={i} />
      ))}
    </>
  )
}
