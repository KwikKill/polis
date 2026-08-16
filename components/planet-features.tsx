'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { PLANET_FEATURES, featureRadius, type PlanetFeature } from '@/lib/planet-builder'
import { buildCurvedFanGeometry, curvedLocalPlacement } from '@/lib/sphere-curve'

const UP = new THREE.Vector3(0, 1, 0)
const LAKE_COLOR = '#29e0ff'
const MOUNTAIN_COLOR = '#2c2540'
const SHORELINE_POINTS = 40
const MOUNTAIN_RINGS = 5
const MOUNTAIN_SPOKES = 20

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

// An organic shoreline, not a perfect circle, two gentle sine harmonics
// perturbing the radius at each angle, seeded by the feature's own index
// (not Math.random()) so the shape is exactly as fixed/shared as its
// position. Kept deliberately mild: stacking more/higher-frequency
// harmonics at real amplitude looks like a spiky pinwheel once triangulated
// as a fan from the center, not an organic shoreline, a lake's radius
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

// Cheap 2D hash for per-vertex height jitter, seeded by ring/spoke/feature
// index (not Math.random()) so the terrain stays fixed for every visitor.
function hash2(i: number, j: number, seed: number): number {
  const x = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453
  return x - Math.floor(x)
}

// A single broad, rounded rise across the whole feature footprint instead
// of a cluster of sharp cone peaks — concentric rings from the apex out to
// the edge, each ring's radius wobbled (same technique as the lake's
// shoreline) and its height following a hemisphere-like profile
// (`sqrt(1-t^2)`, full height at the center tapering smoothly to 0 at the
// edge) plus mild per-vertex noise so it reads as an eroded hill, not a
// perfect dome. Every vertex is placed via `curvedLocalPlacement`, which
// both curves the (x, z) footprint onto the true sphere surface and adds
// the height along *that point's own* local outward direction, not the
// feature center's, the same correction the rest of this file already
// relies on for anything larger than a single point.
function buildMountainGeometry(
  featureR: number,
  maxHeight: number,
  seed: number,
  normal: THREE.Vector3,
  radius: number,
  quaternion: THREE.Quaternion,
): THREE.BufferGeometry {
  const positions: number[] = []

  const apex = curvedLocalPlacement(0, maxHeight, 0, normal, radius, quaternion).position
  positions.push(apex.x, apex.y, apex.z)

  for (let ring = 1; ring <= MOUNTAIN_RINGS; ring++) {
    const t = ring / MOUNTAIN_RINGS
    const profile = Math.sqrt(Math.max(0, 1 - t * t))
    for (let s = 0; s < MOUNTAIN_SPOKES; s++) {
      const angle = (s / MOUNTAIN_SPOKES) * Math.PI * 2
      const wobble =
        1 + 0.16 * Math.sin(angle * 3 + seed * 1.7) + 0.1 * Math.sin(angle * 5 - seed * 2.2)
      const r = featureR * t * wobble
      const noise = (hash2(ring, s, seed) - 0.5) * maxHeight * 0.14 * (1 - t * 0.6)
      const h = Math.max(0, maxHeight * profile + noise)
      const x = Math.cos(angle) * r
      const z = Math.sin(angle) * r
      const p = curvedLocalPlacement(x, h, z, normal, radius, quaternion).position
      positions.push(p.x, p.y, p.z)
    }
  }

  const indices: number[] = []
  for (let s = 0; s < MOUNTAIN_SPOKES; s++) {
    const a = 1 + s
    const b = 1 + ((s + 1) % MOUNTAIN_SPOKES)
    indices.push(0, a, b)
  }
  for (let ring = 1; ring < MOUNTAIN_RINGS; ring++) {
    const innerStart = 1 + (ring - 1) * MOUNTAIN_SPOKES
    const outerStart = 1 + ring * MOUNTAIN_SPOKES
    for (let s = 0; s < MOUNTAIN_SPOKES; s++) {
      const i0 = innerStart + s
      const i1 = innerStart + ((s + 1) % MOUNTAIN_SPOKES)
      const o0 = outerStart + s
      const o1 = outerStart + ((s + 1) % MOUNTAIN_SPOKES)
      indices.push(i0, o0, o1)
      indices.push(i0, o1, i1)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

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

  const geometry = useMemo(
    () => buildMountainGeometry(featureR, featureR * 0.55, seed, normal, radius, quaternion),
    [featureR, seed, normal, radius, quaternion],
  )

  return (
    <mesh geometry={geometry} position={position} quaternion={quaternion}>
      <meshBasicMaterial color={MOUNTAIN_COLOR} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  )
}

// Fixed natural landmarks, same set, same positions, for every visitor
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
