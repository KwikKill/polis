'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { PLANET_FEATURES, featureRadius, type PlanetFeature } from '@/lib/planet-builder'
import { buildCurvedFanGeometry } from '@/lib/sphere-curve'
import { terrainRadius } from '@/lib/terrain'

const UP = new THREE.Vector3(0, 1, 0)
// A violet in the site's own palette family (--secondary is #8a2be2),
// brightened for visibility against the dark ground — replaces the
// original cyan, which read wrong against this magenta/violet scheme.
const LAKE_COLOR = '#9d4dff'
const SHORELINE_POINTS = 40

function useSurfaceTransform(feature: PlanetFeature, radius: number) {
  return useMemo(() => {
    const normal = new THREE.Vector3(
      feature.position[0],
      feature.position[1],
      feature.position[2],
    ).normalize()
    const surfaceRadius = terrainRadius(normal.x, normal.y, normal.z, radius)
    const position = normal.clone().multiplyScalar(surfaceRadius)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal)
    return { position, quaternion, normal, surfaceRadius }
  }, [feature, radius])
}

// An organic shoreline, not a perfect circle, three gentle sine harmonics
// perturbing the radius at each angle (a third, finer one layered on top
// of the original two for more irregular shorelines), seeded by the
// feature's own index (not Math.random()) so the shape is exactly as
// fixed/shared as its position. Kept deliberately mild: stacking more/
// higher-frequency harmonics at real amplitude looks like a spiky
// pinwheel once triangulated as a fan from the center, not an organic
// shoreline, a lake's radius should wander, not slam between near-zero
// and 1.4x every couple samples.
function lakeShapePoints(baseRadius: number, seed: number): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let i = 0; i < SHORELINE_POINTS; i++) {
    const angle = (i / SHORELINE_POINTS) * Math.PI * 2
    const wobble =
      1 +
      0.22 * Math.sin(angle * 3 + seed * 1.7) +
      0.12 * Math.sin(angle * 5 - seed * 2.2) +
      0.07 * Math.sin(angle * 9 + seed * 4.1)
    const r = baseRadius * wobble
    points.push([Math.cos(angle) * r, Math.sin(angle) * r])
  }
  return points
}

// Rendered flat, at one fixed elevation (the lake's own basin radius,
// i.e. the terrain height at its center direction), rather than draped
// per-vertex over the surrounding terrain noise like everything else —
// real water pools level, it doesn't follow every wrinkle of the lake bed.
function Lake({ feature, radius, seed }: { feature: PlanetFeature; radius: number; seed: number }) {
  const { position, quaternion, normal, surfaceRadius } = useSurfaceTransform(feature, radius)
  const featureR = useMemo(() => featureRadius(feature, radius), [feature, radius])

  const geometry = useMemo(() => {
    const outline = lakeShapePoints(featureR, seed)
    return buildCurvedFanGeometry(outline, radius, normal, quaternion, surfaceRadius)
  }, [featureR, seed, radius, normal, quaternion, surfaceRadius])

  return (
    <mesh geometry={geometry} position={position} quaternion={quaternion}>
      <meshBasicMaterial
        color={LAKE_COLOR}
        toneMapped={false}
        transparent
        opacity={0.85}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

// Fixed natural landmarks, same set, same positions, for every visitor
// (see PLANET_FEATURES) — lakes only now, mountains aren't a discrete
// object anymore, "mountain" is just wherever the continuous terrain
// height field (lib/terrain.ts, applied to the planet surface mesh and
// every curved-surface consumer via sphere-curve.ts) happens to be high.
// Lakes still carve out exclusion zones in isValidPlacement, so a city
// can never actually land in one.
export default function PlanetFeatures({ radius }: { radius: number }) {
  return (
    <>
      {PLANET_FEATURES.map((f, i) => (
        <Lake key={i} feature={f} radius={radius} seed={i} />
      ))}
    </>
  )
}
