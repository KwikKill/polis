'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { PLANET_FEATURES, featureRadius, type PlanetFeature } from '@/lib/planet-builder'
import { buildCurvedFanGeometry, curveLocalPoint } from '@/lib/sphere-curve'

const UP = new THREE.Vector3(0, 1, 0)
const LAKE_COLOR = '#1a6ea8'
const MOUNTAIN_COLOR = '#241f2e'
const SHORELINE_POINTS = 40

function useSurfaceTransform(feature: PlanetFeature, radius: number) {
  return useMemo(() => {
    const normal = new THREE.Vector3(
      feature.position[0],
      feature.position[1],
      feature.position[2],
    ).normalize()
    const position = normal.clone().multiplyScalar(radius)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal)
    return { position, quaternion, normal }
  }, [feature, radius])
}

// An organic shoreline, not a perfect circle — two gentle sine harmonics
// perturbing the radius at each angle, seeded by the feature's own index
// (not Math.random()) so the shape is exactly as fixed/shared as its
// position. Kept deliberately mild: stacking more/higher-frequency
// harmonics at real amplitude looks like a spiky pinwheel once triangulated
// as a fan from the center, not an organic shoreline — a lake's radius
// should wander, not slam between near-zero and 1.4x every couple samples.
function lakeShapePoints(baseRadius: number, seed: number): Array<[number, number]> {
  const points: Array<[number, number]> = []
  for (let i = 0; i < SHORELINE_POINTS; i++) {
    const angle = (i / SHORELINE_POINTS) * Math.PI * 2
    const wobble =
      1 + 0.22 * Math.sin(angle * 3 + seed * 1.7) + 0.12 * Math.sin(angle * 5 - seed * 2.2)
    const r = baseRadius * wobble
    points.push([Math.cos(angle) * r, Math.sin(angle) * r])
  }
  return points
}

function Lake({ feature, radius, seed }: { feature: PlanetFeature; radius: number; seed: number }) {
  const { position, quaternion, normal } = useSurfaceTransform(feature, radius)
  const featureR = useMemo(() => featureRadius(feature, radius), [feature, radius])

  const geometry = useMemo(() => {
    const outline = lakeShapePoints(featureR, seed)
    return buildCurvedFanGeometry(outline, radius, normal, quaternion)
  }, [featureR, seed, radius, normal, quaternion])

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

// A small cluster of cones, jittered by index (not Math.random(), so the
// shape stays fixed for every visitor too), each base individually pulled
// onto the sphere's curved surface — one mesh per cone is fine at this
// scale (14 features, ~6 cones each).
function Mountain({
  feature,
  radius,
  seed,
}: {
  feature: PlanetFeature
  radius: number
  seed: number
}) {
  const { position, quaternion, normal } = useSurfaceTransform(feature, radius)
  const featureR = useMemo(() => featureRadius(feature, radius), [feature, radius])

  const peaks = useMemo(() => {
    const count = 5 + (seed % 3)
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + i * 0.7
      const dist = featureR * 0.5 * ((i % 3) / 3 + 0.3)
      const base = curveLocalPoint(
        Math.cos(angle) * dist,
        Math.sin(angle) * dist,
        normal,
        radius,
        quaternion,
      )
      return {
        base,
        height: featureR * (0.5 + (i % 4) * 0.15),
        peakRadius: featureR * 0.28,
      }
    })
  }, [featureR, seed, normal, radius, quaternion])

  return (
    <group position={position} quaternion={quaternion}>
      {peaks.map((p, i) => (
        <mesh key={i} position={[p.base.x, p.base.y + p.height / 2, p.base.z]}>
          <coneGeometry args={[p.peakRadius, p.height, 5]} />
          <meshBasicMaterial color={MOUNTAIN_COLOR} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

// Fixed natural landmarks — same set, same positions, for every visitor
// (see PLANET_FEATURES). They also carve out exclusion zones in
// isValidPlacement, so a city can never actually land on top of one.
export default function PlanetFeatures({ radius }: { radius: number }) {
  return (
    <>
      {PLANET_FEATURES.map((f, i) =>
        f.kind === 'lake' ? (
          <Lake key={i} feature={f} radius={radius} seed={i} />
        ) : (
          <Mountain key={i} feature={f} radius={radius} seed={i} />
        ),
      )}
    </>
  )
}
