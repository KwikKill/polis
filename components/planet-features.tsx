'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { PLANET_FEATURES, type PlanetFeature } from '@/lib/planet-builder'

const UP = new THREE.Vector3(0, 1, 0)
const LAKE_COLOR = '#1a6ea8'
const MOUNTAIN_COLOR = '#241f2e'
const SHORELINE_POINTS = 20

function useSurfaceTransform(feature: PlanetFeature, radius: number) {
  return useMemo(() => {
    const normal = new THREE.Vector3(
      feature.position[0],
      feature.position[1],
      feature.position[2],
    ).normalize()
    const position = normal.clone().multiplyScalar(radius)
    const quaternion = new THREE.Quaternion().setFromUnitVectors(UP, normal)
    return { position, quaternion }
  }, [feature, radius])
}

// An organic shoreline, not a perfect circle — a few layered sine
// harmonics perturbing the radius at each angle, seeded by the feature's
// own index (not Math.random()) so the shape is exactly as fixed/shared as
// its position.
function lakeShapePoints(baseRadius: number, seed: number): THREE.Vector2[] {
  const points: THREE.Vector2[] = []
  for (let i = 0; i < SHORELINE_POINTS; i++) {
    const angle = (i / SHORELINE_POINTS) * Math.PI * 2
    const wobble =
      0.8 +
      0.16 * Math.sin(angle * 3 + seed * 1.7) +
      0.11 * Math.sin(angle * 5 + seed * 3.1) +
      0.07 * Math.sin(angle * 2 - seed * 0.6)
    const r = baseRadius * Math.max(0.55, wobble)
    points.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r))
  }
  return points
}

function Lake({ feature, radius, seed }: { feature: PlanetFeature; radius: number; seed: number }) {
  const { position, quaternion } = useSurfaceTransform(feature, radius)
  const geometry = useMemo(() => {
    const shape = new THREE.Shape(lakeShapePoints(feature.radius, seed))
    return new THREE.ShapeGeometry(shape, 24)
  }, [feature, seed])

  return (
    <group position={position} quaternion={quaternion}>
      {/* ShapeGeometry's default normal is +Z, same as CircleGeometry; tilt
          it flat against the already-oriented parent group's local +Y. */}
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <meshBasicMaterial color={LAKE_COLOR} toneMapped={false} transparent opacity={0.85} />
      </mesh>
    </group>
  )
}

// A small cluster of cones, jittered by index (not Math.random(), so the
// shape stays fixed for every visitor too) rather than a single peak — one
// mesh per cone is fine at this scale (14 features, ~6 cones each).
function Mountain({ feature, radius }: { feature: PlanetFeature; radius: number }) {
  const { position, quaternion } = useSurfaceTransform(feature, radius)

  const peaks = useMemo(() => {
    const count = 5 + (feature.radius % 3)
    return Array.from({ length: count }, (_, i) => {
      const angle = (i / count) * Math.PI * 2 + i * 0.7
      const dist = feature.radius * 0.5 * ((i % 3) / 3 + 0.3)
      return {
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        height: feature.radius * (0.5 + (i % 4) * 0.15),
        peakRadius: feature.radius * 0.28,
      }
    })
  }, [feature])

  return (
    <group position={position} quaternion={quaternion}>
      {peaks.map((p, i) => (
        <mesh key={i} position={[p.x, p.height / 2, p.z]}>
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
          <Mountain key={i} feature={f} radius={radius} />
        ),
      )}
    </>
  )
}
